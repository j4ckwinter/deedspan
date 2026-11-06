import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { runDraftUpdateModelVerification } from '../scripts/verify-draft-update-model.js';
import { messageSchema } from '../src/core/types.js';
import {
  draftsSchema,
  updateDraftResultSchema,
} from '../examples/drafts/src/contracts.js';

const model = 'test-update:4b';
async function fixture(
  mode:
    | 'happy'
    | 'omit-retrieval'
    | 'unavailable'
    | 'rejected'
    | 'stale'
    | 'rejected-success'
    | 'rejected-retry'
    | 'rejected-provider-error'
    | 'stale-success'
    | 'stale-skip-conflict'
    | 'stale-retry',
) {
  const negative = mode.startsWith('rejected') || mode.startsWith('stale');
  const terminal = mode.startsWith('rejected') ? 'rejected' : 'conflict';
  const directory = await mkdtemp(join(tmpdir(), 'update-verification-test-'));
  const notificationPositions = new Map<string, number>();
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
      const results = body.messages.filter(
        (message) => message.role === 'tool',
      );
      const notifications = body.messages.filter(
        (message) =>
          message.role === 'user' &&
          message.content?.startsWith('The automated test operator'),
      );
      if (results.length < 2) assert.equal(notifications.length, 0);
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
      if (results.length === 0) reply = call('search_drafts', {});
      else {
        const first = results[0];
        assert(first?.content);
        const drafts = draftsSchema.parse(JSON.parse(first.content));
        assert.equal(drafts.length, 1);
        const draft = drafts[0];
        assert(draft);
        if (results.length >= 2 && notifications.length) {
          assert.equal(notifications.length, 1);
          const notification = notifications[0];
          assert(notification?.content);
          const pending = results[1];
          assert(pending?.content);
          const operation = updateDraftResultSchema.parse(
            JSON.parse(pending.content),
          );
          assert.equal(operation.status, 'confirmation_required');
          assert(notification.content.includes(operation.operationId));
          assert(notification.content.includes(draft.id));
          if (!negative)
            assert.match(
              notification.content,
              /retry update_draft.*get_updated_draft/,
            );
          else if (terminal === 'rejected')
            assert.match(notification.content, /has rejected.*not authorized/);
          else
            assert.match(
              notification.content,
              /separate approved edit.*Retry update_draft/,
            );
          const position = body.messages.indexOf(notification);
          assert(
            position > body.messages.indexOf(pending),
            'Approval notice must follow the real pending tool output',
          );
          const previous = notificationPositions.get(draft.id);
          if (previous === undefined)
            notificationPositions.set(draft.id, position);
          else
            assert.equal(
              position,
              previous,
              'Approval notice must retain its historical position',
            );
        }
        if (results.length === 1)
          reply = call('update_draft', { id: draft.id });
        else if (results.length === 2) {
          const pending = results[1];
          assert(pending?.content);
          assert.equal(
            updateDraftResultSchema.parse(JSON.parse(pending.content)).status,
            'confirmation_required',
          );
          reply = notifications.length
            ? call('update_draft', { id: draft.id })
            : {
                content:
                  'Waiting for the user to approve the pending operation.',
              };
          if (negative && notifications.length) {
            if (mode === 'rejected-provider-error')
              throw new Error('Provider failed after rejection');
            if (mode === 'rejected')
              reply = { content: JSON.stringify({ status: 'rejected' }) };
            if (mode === 'rejected-success')
              reply = { content: JSON.stringify({ status: 'completed' }) };
            if (mode === 'stale-skip-conflict')
              reply = { content: JSON.stringify({ status: 'conflict' }) };
          }
        } else if (negative) {
          const terminalResult = results[2];
          assert(terminalResult?.content);
          assert.equal(
            updateDraftResultSchema.parse(JSON.parse(terminalResult.content))
              .status,
            terminal,
          );
          reply =
            mode === 'stale-retry' && results.length === 3
              ? call('update_draft', { id: draft.id })
              : {
                  content: JSON.stringify({
                    status: mode === 'stale-success' ? 'completed' : terminal,
                  }),
                };
        } else if (results.length === 3 && mode !== 'omit-retrieval') {
          const completed = results[2];
          assert(completed?.content);
          assert.equal(
            updateDraftResultSchema.parse(JSON.parse(completed.content)).status,
            'completed',
          );
          reply = call('get_updated_draft', {});
        } else reply = { content: 'Updated the record.' };
      }
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

test('update model check verifies two titles through real SDK, approval, retry, persistence and retrieval', async () => {
  const local = await fixture('happy');
  try {
    const options = {
      model,
      ollama: local.endpoint,
      output: local.directory,
      titles: ['First update', 'Café launch — 東京'],
    };
    const report = await runDraftUpdateModelVerification(options);
    assert.equal(report.status, 'passed', JSON.stringify(report));
    assert.equal(report.approval, 'automated test operator, not human');
    assert.equal(report.trials.length, 2);
    const identity = z
      .object({
        digest: z.string(),
        version: z.string(),
        template: z.string(),
        parameters: z.string(),
      })
      .parse(await read(report.directory, 'identity.json'));
    assert.deepEqual(identity, {
      digest: 'test-digest',
      version: 'test-version',
      template: 'test-template',
      parameters: 'temperature 0',
    });
    for (const trial of report.trials) {
      assert.equal(trial.status, 'passed');
      if (trial.status !== 'passed') continue;
      const before = draftsSchema.parse(
        await read(trial.directory, 'before.json'),
      );
      const waiting = z
        .object({
          drafts: draftsSchema,
          pending: z.array(z.object({ title: z.string() })),
        })
        .parse(await read(trial.directory, 'before-approval.json'));
      assert.deepEqual(waiting.drafts, before);
      assert.deepEqual(
        waiting.pending.map((operation) => operation.title),
        [trial.title],
      );
      const after = draftsSchema.parse(
        await read(trial.directory, 'after.json'),
      );
      const target = after.find((draft) => draft.id === trial.draftId);
      assert(target);
      assert.equal(target.title, trial.title);
      assert.equal(target.version, 2);
      assert.equal(after.length, 2);
      const files = await readdir(trial.directory);
      assert(files.includes('model-5-response.json'));
      const rawRequest = await readFile(
        join(trial.directory, 'model-1-request.json'),
        'utf8',
      );
      assert.doesNotMatch(rawRequest, /Authorization|Cookie|X-CSRF/i);
    }
    const again = await runDraftUpdateModelVerification({
      ...options,
      titles: ['First update'],
    });
    assert.equal(again.status, 'passed', JSON.stringify(again));
    assert.notEqual(again.directory, report.directory);
    assert.deepEqual(await read(report.directory, 'report.json'), report);
  } finally {
    await local.close();
  }
});

test('successful mutation without model retrieval fails verification and retains the saved result', async () => {
  const local = await fixture('omit-retrieval');
  try {
    const report = await runDraftUpdateModelVerification({
      model,
      ollama: local.endpoint,
      output: local.directory,
      titles: ['Saved but unverified'],
    });
    assert.equal(report.status, 'failed');
    const trial = report.trials[0];
    assert(trial && trial.status === 'failed');
    assert.equal(trial.stage, 'verification');
    assert.match(trial.error, /Agent must retrieve/);
    const final = z
      .object({ drafts: draftsSchema })
      .parse(await read(trial.directory, 'final-state.json'));
    assert(
      final.drafts.some(
        (draft) =>
          draft.title === 'Saved but unverified' && draft.version === 2,
      ),
    );
    assert.deepEqual(await read(report.directory, 'report.json'), report);
  } finally {
    await local.close();
  }
});

test('metadata errors are reported before inference and remote endpoints are refused', async () => {
  const local = await fixture('unavailable');
  try {
    const report = await runDraftUpdateModelVerification({
      model,
      ollama: local.endpoint,
      output: local.directory,
    });
    assert.equal(report.status, 'failed');
    assert.match(report.setupError ?? '', /503/);
    assert.equal(report.trials.length, 2);
    assert.deepEqual(await read(report.directory, 'version.json'), {
      status: 503,
      body: '{"error":"unavailable"}',
    });
    const remote = await runDraftUpdateModelVerification({
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

test('negative decisions separate backend safety from compliant model stopping', async () => {
  for (const scenario of ['rejected', 'stale'] as const) {
    const local = await fixture(scenario);
    try {
      const report = await runDraftUpdateModelVerification({
        model,
        scenario,
        ollama: local.endpoint,
        output: local.directory,
        titles: ['Must not overwrite'],
      });
      assert.equal(report.scenario, scenario);
      assert.equal(report.status, 'passed', JSON.stringify(report));
      const trial = report.trials[0];
      assert(trial);
      assert.deepEqual(trial.checks, {
        backendSafety: 'passed',
        modelBehavior: 'passed',
        terminalOutcome: scenario === 'rejected' ? 'rejected' : 'conflict',
      });
      const before = draftsSchema.parse(
        await read(trial.directory, 'before.json'),
      );
      const final = z
        .object({
          drafts: draftsSchema,
          events: z.array(z.object({ outcome: z.string() })),
        })
        .parse(await read(trial.directory, 'final-state.json'));
      if (scenario === 'rejected') assert.deepEqual(final.drafts, before);
      else {
        const target = final.drafts.find(
          (draft) => draft.title === 'Intervening edit 1',
        );
        assert(target);
        assert.equal(target.version, 2);
        assert.equal(
          final.events.filter((event) => event.outcome === 'update_completed')
            .length,
          1,
        );
      }
      assert(
        !final.drafts.some((draft) => draft.title === 'Must not overwrite'),
      );
      assert.deepEqual(await read(report.directory, 'report.json'), report);
    } finally {
      await local.close();
    }
  }
});

test('false success, rejected retries, and missing or repeated conflict observation fail model behavior without hiding backend safety', async () => {
  for (const mode of [
    'rejected-success',
    'rejected-retry',
    'rejected-provider-error',
    'stale-success',
    'stale-skip-conflict',
    'stale-retry',
  ] as const) {
    const local = await fixture(mode);
    try {
      const scenario = mode.startsWith('rejected') ? 'rejected' : 'stale';
      const report = await runDraftUpdateModelVerification({
        model,
        scenario,
        ollama: local.endpoint,
        output: local.directory,
        titles: ['Must not overwrite'],
      });
      assert.equal(report.status, 'failed', mode);
      const trial = report.trials[0];
      assert(trial && trial.status === 'failed');
      assert.equal(trial.checks.backendSafety, 'passed', JSON.stringify(trial));
      assert.equal(trial.checks.modelBehavior, 'failed');
      const final = z
        .object({ drafts: draftsSchema })
        .parse(await read(trial.directory, 'final-state.json'));
      assert(
        !final.drafts.some((draft) => draft.title === 'Must not overwrite'),
      );
      assert.deepEqual(await read(report.directory, 'report.json'), report);
    } finally {
      await local.close();
    }
  }
});
