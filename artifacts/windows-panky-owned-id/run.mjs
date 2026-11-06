import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ToolRegistry } from '../../lib/index.js';
import { createApiApp } from '../../server/app.ts';
import { createApp } from '../../examples/drafts/src/app.ts';
import { DraftStore } from '../../examples/drafts/src/store.ts';
import { registerDraftTools } from './tools.mjs';
import { executeTask } from '../../src/core/execute-task.ts';
import { agentReplySchema } from '../../src/core/types.ts';

const directory = new URL('./', import.meta.url);
const model = 'panky-qwen3:4b';
const password = crypto.randomUUID();
const database = new URL(
  `./verification-${crypto.randomUUID()}.sqlite`,
  directory,
);
const store = new DraftStore(fileURLToPath(database));
store.seed(password);
const app = createServer();
const proxy = createServer();
const listen = async (server) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const origin = await listen(app);
app.on('request', createApp(store, origin));
const proxyOrigin = await listen(proxy);
let activeRun;
const record = (entry) =>
  appendFileSync(
    new URL('./trace.jsonl', directory),
    JSON.stringify({ at: new Date().toISOString(), run: activeRun, ...entry }) +
      '\n',
  );
proxy.on(
  'request',
  createApiApp(
    { baseUrl: 'http://127.0.0.1:11434/v1', model },
    async (url, options) => {
      const started = performance.now();
      record({ kind: 'model-request', body: JSON.parse(options.body) });
      try {
        const response = await fetch(url, options);
        record({
          kind: 'model-response',
          status: response.status,
          elapsedMs: performance.now() - started,
          body: await response.clone().text(),
        });
        return response;
      } catch (error) {
        record({
          kind: 'model-transport-error',
          elapsedMs: performance.now() - started,
          error: String(error),
        });
        throw error;
      }
    },
  ),
);
const login = async () => {
  const response = await fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password }),
  });
  assert.equal(response.status, 200);
  const { csrf } = await response.json();
  const cookie = response.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  return async (path, body, callId) => {
    const response = await fetch(`${origin}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': csrf,
        ...(callId ? { 'X-Tool-Call-Id': callId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const output = await response.json();
    record({
      kind: 'application-response',
      path,
      callId,
      status: response.status,
      output,
    });
    if (!response.ok) throw new Error(JSON.stringify(output));
    return output;
  };
};
const results = [];
try {
  const request = await login();
  const operator = await login();
  for (const title of [
    'Windows Qwen launch notes 2026-11-06',
    'Windows Qwen autumn campaign 2026-11-06',
  ]) {
    activeRun = title;
    const started = performance.now();
    const before = await operator('/drafts');
    const traces = [];
    const approvals = [];
    const registry = new ToolRegistry();
    registerDraftTools(registry, request);
    let message;
    let failure;
    try {
      message = await executeTask({
        prompt: `Create a draft titled ${JSON.stringify(title)} in the Marketing project, then retrieve it.`,
        instructions:
          'Use the available tools to inspect accessible projects and complete the task. The application manages operation IDs and reuses them on retries. Approval is handled separately by the user. Only claim success after retrieving the saved draft.',
        tools: {
          list: () => registry.list(),
          call: async (name, input) => {
            const trace = await registry.call(name, input);
            traces.push(trace);
            record({ kind: 'tool-trace', trace });
            if (trace.output?.status !== 'confirmation_required') return trace;
            assert.deepEqual(
              await operator('/drafts'),
              before,
              'No draft may exist before approval',
            );
            const pending = await operator('/approvals');
            assert.equal(pending.length, 1);
            assert.equal(pending[0].id, trace.output.operationId);
            assert.equal(pending[0].title, title);
            assert.equal(pending[0].project_id, 'marketing');
            approvals.push(await operator(`/approvals/${pending[0].id}`, {}));
            const retried = await registry.call(name, input);
            traces.push(retried);
            record({
              kind: 'tool-trace-after-operator-approval',
              trace: retried,
            });
            return retried;
          },
        },
        step: async (input) => {
          const response = await fetch(`${proxyOrigin}/api/agent/step`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          });
          const output = await response.json();
          if (!response.ok)
            throw new Error(
              `Proxy HTTP ${response.status}: ${JSON.stringify(output)}`,
            );
          return agentReplySchema.parse(output);
        },
        onTrace: () => {},
      });
      const after = await operator('/drafts');
      const created = after.filter(
        (draft) => !before.some((old) => old.id === draft.id),
      );
      assert.equal(created.length, 1, 'Exactly one new draft');
      assert.equal(created[0].title, title);
      assert.equal(created[0].project_id, 'marketing');
      assert.equal(approvals.length, 1, 'Exactly one approval');
      assert(
        traces.some(
          (t) =>
            t.name === 'search_projects' &&
            t.status === 'success' &&
            t.output.some((p) => p.id === 'marketing'),
        ),
      );
      assert(
        traces.some(
          (t) =>
            t.name === 'get_draft' &&
            t.status === 'success' &&
            t.output.id === created[0].id,
        ),
      );
      const independent = new DatabaseSync(database);
      try {
        assert.deepEqual(
          {
            ...independent
              .prepare('SELECT * FROM drafts WHERE id = ?')
              .get(created[0].id),
          },
          created[0],
        );
      } finally {
        independent.close();
      }
    } catch (error) {
      failure = { message: String(error), stack: error.stack };
    }
    const result = {
      title,
      model,
      status: failure ? 'failed' : 'passed',
      elapsedMs: performance.now() - started,
      message,
      failure,
      before,
      after: await operator('/drafts'),
      approvals,
      traces,
      events: await operator('/events'),
      calls: await operator('/calls'),
    };
    results.push(result);
    writeFileSync(
      new URL('./results.json', directory),
      JSON.stringify(
        {
          node: process.version,
          platform: process.platform,
          model,
          approval:
            'Separate authenticated test operator, not a human UI click; same retry behavior as existing CLI harness',
          results,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        title,
        status: result.status,
        failure,
        elapsedMs: result.elapsedMs,
      }),
    );
  }
} finally {
  await Promise.all(
    [app, proxy].map(
      (server) => new Promise((resolve) => server.close(resolve)),
    ),
  );
  store.close();
  unlinkSync(database);
}
if (results.some((result) => result.status === 'failed')) process.exitCode = 1;
