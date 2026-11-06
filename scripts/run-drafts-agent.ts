import assert from 'node:assert/strict';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ToolRegistry, type ToolTrace } from 'deedspan';
import { z } from 'zod';
import {
  registerDraftTaskTools,
  type DraftRequest,
} from '../examples/drafts/src/tools.js';
import {
  draftSchema,
  sessionSchema,
  errorSchema,
  createDraftResultSchema,
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
const { values, positionals } = parseArgs({
  options: { resume: { type: 'string' } },
  allowPositionals: true,
});
if (positionals.length > 1 || (values.resume && positionals.length))
  throw new Error('Use a draft title or --resume <task-file>, not both.');
const taskSchema = z
  .object({
    version: z.literal(1),
    operationId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    origin: z.url(),
    before: z.array(draftSchema),
  })
  .strict();
const resumed = values.resume
  ? taskSchema.parse(JSON.parse(readFileSync(resolve(values.resume), 'utf8')))
  : undefined;
if (resumed && resumed.origin !== origin)
  throw new Error('Saved task belongs to a different DRAFTS_ORIGIN.');
const title = taskSchema.shape.title.parse(
  resumed?.title ??
    positionals[0] ??
    `Agent integration ${crypto.randomUUID()}`,
);
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
const task =
  resumed ??
  taskSchema.parse({
    version: 1,
    operationId: crypto.randomUUID(),
    title,
    origin,
    before: await request('/drafts'),
  });
const taskDirectory = resolve(
  process.env.DRAFTS_RUN_DIR ?? '.data/draft-agent',
);
const taskFile = values.resume
  ? resolve(values.resume)
  : resolve(taskDirectory, `${task.operationId}.json`);
if (!resumed) {
  mkdirSync(taskDirectory, { recursive: true });
  writeFileSync(taskFile, JSON.stringify(task, null, 2) + '\n', {
    flag: 'wx',
    flush: true,
  });
}
console.log(JSON.stringify({ taskFile, operationId: task.operationId }));
const registry = new ToolRegistry({
  onTrace: (trace) => {
    console.log(JSON.stringify(trace));
  },
});
registerDraftTaskTools(registry, request, task.operationId);
const traces: ToolTrace[] = [];
const pendingSchema = z.object({
  status: z.literal('confirmation_required'),
  operationId: z.string(),
});
const message = await executeTask({
  prompt: `Create a draft titled ${JSON.stringify(title)} in the Marketing project, then retrieve it.`,
  instructions:
    'Use the available tools to inspect accessible projects and complete the task. The application manages operation IDs and reuses them on retries. Approval is handled separately by the user. Only claim success after retrieving the saved draft.',
  tools: {
    list: () => registry.list(),
    call: async (name, input) => {
      const trace = await registry.call(name, input);
      const pending = pendingSchema.safeParse(trace.output);
      if (!pending.success) return trace;
      traces.push(trace);
      if (!stdin.isTTY)
        throw new Error(
          `Approval requires the example browser UI. Approve the pending operation there, then resume with --resume ${JSON.stringify(taskFile)}.`,
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
const completedDraftIds = new Set<string>();
for (const trace of traces) {
  if (trace.name !== 'create_draft' || trace.status !== 'success') continue;
  const result = createDraftResultSchema.safeParse(trace.output);
  if (
    result.success &&
    result.data.operationId === task.operationId &&
    result.data.status === 'completed' &&
    result.data.draftId
  )
    completedDraftIds.add(result.data.draftId);
}
assert.equal(completedDraftIds.size, 1, 'Task must complete exactly one draft');
const created = after.filter((draft) => completedDraftIds.has(draft.id));
assert.equal(created.length, 1, 'Task draft must exist in the application');
const draft = created[0]!;
assert(
  !task.before.some((previous) => previous.id === draft.id),
  'Task must create its own draft rather than claim a pre-existing one',
);
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
