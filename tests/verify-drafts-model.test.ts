import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { runModelVerification } from '../scripts/verify-drafts-model.js';
import { messageSchema } from '../src/core/types.js';
import { createDraftResultSchema } from '../examples/drafts/src/contracts.js';

const model = 'test-local:4b';
async function fixture(mode: 'happy' | 'forbidden-title' | 'unavailable') {
  const directory = await mkdtemp(join(tmpdir(), 'model-verification-test-'));
  const server = createServer((req, res) => {
    void (async () => {
      res.setHeader('Content-Type', 'application/json');
      if (mode === 'unavailable') {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: 'unavailable' }));
        return;
      }
      if (req.url === '/api/version') {
        res.end(JSON.stringify({ version: 'test-version' }));
        return;
      }
      if (req.url === '/api/tags') {
        res.end(
          JSON.stringify({ models: [{ name: model, digest: 'test-digest' }] }),
        );
        return;
      }
      if (req.url === '/api/show') {
        res.end(
          JSON.stringify({
            template: 'test-template',
            parameters: 'temperature 0',
          }),
        );
        return;
      }
      assert.equal(req.url, '/v1/chat/completions');
      assert.equal(req.headers.authorization, undefined);
      let raw = '';
      for await (const chunk of req) raw += String(chunk);
      const body = z
        .object({ model: z.literal(model), messages: z.array(messageSchema) })
        .parse(JSON.parse(raw));
      const prompt = body.messages.find(
        (message) => message.role === 'user',
      )?.content;
      assert(prompt);
      const titleMatch = /titled (".*") in the Marketing/.exec(prompt);
      assert(titleMatch?.[1]);
      const title = z.string().parse(JSON.parse(titleMatch[1]));
      const results = body.messages.filter(
        (message) => message.role === 'tool',
      );
      const call = (name: string, args: unknown) => ({
        content: null,
        tool_calls: [
          {
            id: crypto.randomUUID(),
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      });
      let reply;
      if (results.length === 0) reply = call('search_projects', {});
      else if (results.length === 1)
        reply = call('create_draft', {
          projectId: 'marketing',
          ...(mode === 'forbidden-title' && title === 'First'
            ? { title: 'Injected title' }
            : {}),
        });
      else if (results.length === 2) {
        const result = results[1];
        assert(result?.content);
        if (mode === 'forbidden-title' && title === 'First') {
          const rejected = z
            .object({ error: z.string() })
            .parse(JSON.parse(result.content));
          assert.match(rejected.error, /title/);
          reply = { content: 'The supplied title was rejected.' };
        } else {
          createDraftResultSchema.parse(JSON.parse(result.content));
          reply = call('get_draft', {});
        }
      } else reply = { content: 'Created and retrieved.' };
      res.end(JSON.stringify({ choices: [{ message: reply }] }));
    })().catch((error: unknown) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(error) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    directory,
    endpoint: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const read = async (directory: string, name: string): Promise<unknown> =>
  JSON.parse(await readFile(join(directory, name), 'utf8'));

test('model check runs real CLI approval/resume for two titles and retains independent evidence', async () => {
  const local = await fixture('happy');
  try {
    const options = {
      model,
      ollama: local.endpoint,
      output: local.directory,
      titles: ['First', '--launch'],
    };
    const report = await runModelVerification(options);
    assert.equal(report.status, 'passed', JSON.stringify(report));
    assert.equal(report.approval, 'automated test operator, not human');
    assert.equal(report.trials.length, 2);
    const identity = z
      .object({
        digest: z.string(),
        template: z.string(),
        parameters: z.string(),
      })
      .parse(await read(report.directory, 'identity.json'));
    assert.deepEqual(identity, {
      digest: 'test-digest',
      template: 'test-template',
      parameters: 'temperature 0',
    });
    for (const trial of report.trials) {
      const before = z
        .object({
          drafts: z.array(z.unknown()),
          pending: z.array(z.object({ title: z.string() })),
        })
        .parse(await read(trial.directory, 'before-approval.json'));
      assert.equal(before.drafts.length, 0);
      assert.deepEqual(
        before.pending.map((operation) => operation.title),
        [trial.title],
      );
      const final = z
        .object({
          drafts: z.array(z.object({ title: z.string() })),
          events: z.array(z.object({ outcome: z.string() })),
        })
        .parse(await read(trial.directory, 'final-state.json'));
      assert.deepEqual(
        final.drafts.map((draft) => draft.title),
        [trial.title],
      );
      assert.deepEqual(
        final.events.map((event) => event.outcome),
        ['confirmation_required', 'approved', 'completed'],
      );
      assert(
        (await readdir(trial.directory)).includes('model-1-response.json'),
      );
      const rawRequest = await readFile(
        join(trial.directory, 'model-1-request.json'),
        'utf8',
      );
      assert.doesNotMatch(rawRequest, /Authorization|Cookie|X-CSRF/i);
    }
    const again = await runModelVerification({ ...options, titles: ['First'] });
    assert.equal(again.status, 'passed', JSON.stringify(again));
    assert.notEqual(again.directory, report.directory);
    assert.deepEqual(await read(report.directory, 'report.json'), report);
  } finally {
    await local.close();
  }
});

test('forbidden title fails validation before approval and does not prevent the next trial', async () => {
  const local = await fixture('forbidden-title');
  try {
    const report = await runModelVerification({
      model,
      ollama: local.endpoint,
      output: local.directory,
      titles: ['First', 'Second'],
    });
    assert.equal(report.status, 'failed');
    assert.deepEqual(
      report.trials.map((trial) => trial.status),
      ['failed', 'passed'],
    );
    const first = report.trials[0];
    assert(first);
    assert.equal(first.status, 'failed');
    if (first.status === 'failed')
      assert.match(first.error, /Task must complete exactly one draft/);
    const state = z
      .object({
        drafts: z.array(z.unknown()),
        events: z.array(z.object({ outcome: z.string() })),
      })
      .parse(await read(first.directory, 'final-state.json'));
    assert.deepEqual(state.drafts, []);
    assert.deepEqual(
      state.events.map((event) => event.outcome),
      [],
    );
    assert(!(await readdir(first.directory)).includes('approval.json'));
  } finally {
    await local.close();
  }
});

test('metadata failures retain a failed report and raw response without starting inference', async () => {
  const local = await fixture('unavailable');
  try {
    const report = await runModelVerification({
      model,
      ollama: local.endpoint,
      output: local.directory,
    });
    assert.equal(report.status, 'failed');
    assert.match(report.setupError ?? '', /503/);
    assert.equal(report.trials.length, 2);
    assert.deepEqual(await read(report.directory, 'report.json'), report);
    assert.deepEqual(await read(report.directory, 'version.json'), {
      status: 503,
      body: '{"error":"unavailable"}',
    });
    const remote = await runModelVerification({
      model,
      ollama: 'https://example.com',
      output: local.directory,
    });
    assert.equal(remote.status, 'failed');
    assert.match(remote.setupError ?? '', /localhost/);
  } finally {
    await local.close();
  }
});
