import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import test from 'node:test';
import { createApp } from '../examples/drafts/src/app.js';
import { DraftStore } from '../examples/drafts/src/store.js';
import { agentRequestSchema } from '../src/core/types.js';
import { createDraftResultSchema } from '../examples/drafts/src/contracts.js';

const execute = promisify(execFile);
test('model harness uses tool calls and independently verifies a persistent outcome', async () => {
  const store = new DraftStore(':memory:');
  const password = 'harness-test-password';
  store.seed(password);
  const app = createServer();
  const model = createServer();
  const listen = async (server: ReturnType<typeof createServer>) => {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    assert(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
  };
  const appOrigin = await listen(app);
  app.on('request', createApp(store, appOrigin));
  const modelOrigin = await listen(model);
  const input = {
    operationId: crypto.randomUUID(),
    projectId: 'marketing',
    title: 'Harness outcome',
  };
  const alice = { id: 'alice', name: 'Alice' };
  const selected: string[] = [];
  model.on('request', (req, res) => {
    void (async () => {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      const request = agentRequestSchema.parse(JSON.parse(body));
      const results = request.messages.filter(
        (message) => message.role === 'tool',
      );
      const call = (name: string, args: unknown) => {
        selected.push(name);
        return {
          content: null,
          tool_calls: [
            {
              id: crypto.randomUUID(),
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        };
      };
      let reply;
      if (results.length === 0) reply = call('search_projects', {});
      else if (results.length === 1) {
        store.create(alice, input);
        store.approve(alice, input.operationId);
        reply = call('create_draft', input);
      } else if (results.length === 2) {
        const result = createDraftResultSchema.parse(
          JSON.parse(results[1]!.content!),
        );
        reply = call('get_draft', { id: result.draftId });
      } else reply = { content: 'Created and retrieved.' };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(reply));
    })().catch((error: unknown) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });
  try {
    const { stdout } = await execute(
      process.execPath,
      ['--import', 'tsx', 'scripts/run-drafts-agent.ts', input.title],
      {
        env: {
          ...process.env,
          DRAFTS_ORIGIN: appOrigin,
          WORKBENCH_ORIGIN: modelOrigin,
          DRAFTS_PASSWORD: password,
        },
        timeout: 15000,
      },
    );
    assert.match(stdout, /"status": "passed"/);
    assert.deepEqual(selected, [
      'search_projects',
      'create_draft',
      'get_draft',
    ]);
    assert.equal(store.drafts(alice).length, 1);
  } finally {
    await Promise.all(
      [app, model].map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
    );
    store.close();
  }
});
