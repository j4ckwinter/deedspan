import assert from 'node:assert/strict';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ToolRegistry, type ToolTrace } from 'deedspan';
import { z } from 'zod';
import {
  registerDraftTools,
  type DraftRequest,
} from '../examples/drafts/src/tools.js';
import {
  draftSchema,
  sessionSchema,
  errorSchema,
} from '../examples/drafts/src/contracts.js';
import { executeTask } from '../src/core/execute-task.js';
import { agentReplySchema } from '../src/core/types.js';

const origin = process.env.DRAFTS_ORIGIN ?? 'http://127.0.0.1:3101';
const workbench = process.env.WORKBENCH_ORIGIN ?? 'http://127.0.0.1:3000';
const password = process.env.DRAFTS_PASSWORD;
if (!password)
  throw new Error(
    'Set DRAFTS_PASSWORD to the password used to seed the example.',
  );
const title = process.argv[2] ?? `Agent integration ${crypto.randomUUID()}`;
const login = await fetch(`${origin}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify({ username: 'alice', password }),
});
if (!login.ok) throw new Error(`Example login failed: HTTP ${login.status}`);
const { csrf } = sessionSchema.parse(await login.json());
const cookie = login.headers
  .getSetCookie()
  .map((value) => value.split(';')[0])
  .join('; ');
const request: DraftRequest = async (path, body, callId) => {
  const response = await fetch(`${origin}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      ...(callId ? { 'X-Tool-Call-Id': callId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error(errorSchema.parse(result).error);
  return result;
};
const before = z.array(draftSchema).parse(await request('/drafts'));
const registry = new ToolRegistry({
  onTrace: (trace) => {
    console.log(JSON.stringify(trace));
  },
});
registerDraftTools(registry, request);
const traces: ToolTrace[] = [];
const pendingSchema = z.object({
  status: z.literal('confirmation_required'),
  operationId: z.string(),
});
const message = await executeTask({
  prompt: `Create a draft titled ${JSON.stringify(title)} in the Marketing project, then retrieve it.`,
  instructions:
    'Use the available tools to inspect accessible projects and complete the task. Generate a UUID for each logical operation and reuse it on retries. Approval is handled separately by the user. Only claim success after retrieving the saved draft.',
  tools: {
    list: () => registry.list(),
    call: async (name, input) => {
      const trace = await registry.call(name, input);
      const pending = pendingSchema.safeParse(trace.output);
      if (!pending.success) return trace;
      traces.push(trace);
      if (!stdin.isTTY)
        throw new Error(
          'Approval requires an interactive terminal and the example browser UI.',
        );
      const terminal = createInterface({ input: stdin, output: stdout });
      try {
        await terminal.question(
          `Open ${origin}, sign in as alice, refresh, and approve operation ${pending.data.operationId}. Press Enter after approving: `,
        );
      } finally {
        terminal.close();
      }
      return registry.call(name, input);
    },
  },
  step: async (input, signal) => {
    const response = await fetch(`${workbench}/api/agent/step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: signal ?? null,
    });
    if (!response.ok)
      throw new Error(
        `Model proxy returned HTTP ${response.status}. Check the workbench model configuration.`,
      );
    return agentReplySchema.parse(await response.json());
  },
  onTrace: (trace) => {
    traces.push(trace);
  },
});
const after = z.array(draftSchema).parse(await request('/drafts'));
const created = after.filter(
  (draft) => !before.some((previous) => previous.id === draft.id),
);
assert.equal(created.length, 1, 'Expected exactly one newly persisted draft');
const draft = created[0]!;
assert.equal(draft.title, title);
assert.equal(draft.project_id, 'marketing');
assert(
  traces.some(
    (trace) =>
      trace.name === 'get_draft' &&
      trace.status === 'success' &&
      draftSchema.safeParse(trace.output).data?.id === draft.id,
  ),
  'Agent must retrieve the saved draft',
);
console.log(
  JSON.stringify(
    { status: 'passed', draftId: draft.id, modelMessage: message },
    null,
    2,
  ),
);
