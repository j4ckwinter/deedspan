import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { createApp } from '../examples/drafts/src/app.js';
import { DraftStore } from '../examples/drafts/src/store.js';
import { agentRequestSchema } from '../src/core/types.js';
import {
  createDraftResultSchema,
  draftsSchema,
} from '../examples/drafts/src/contracts.js';

const manifestSchema = z.object({
  version: z.literal(1),
  operationId: z.uuid(),
  title: z.string(),
  origin: z.url(),
  before: draftsSchema,
});
const taskLocationSchema = z.object({
  taskFile: z.string(),
  operationId: z.uuid(),
});
const close = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
const listen = async (server: ReturnType<typeof createServer>, port = 0) => {
  await new Promise<void>((resolve) =>
    server.listen(port, '127.0.0.1', resolve),
  );
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
};

test('a durable agent task survives approval and backend restarts without duplicating its draft', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'draft-agent-'));
  const runDirectory = join(directory, 'tasks');
  const database = join(directory, 'drafts.sqlite');
  let store = new DraftStore(database);
  const password = 'harness-test-password';
  store.seed(password);
  let app = createServer();
  const model = createServer();
  const appOrigin = await listen(app);
  app.on('request', createApp(store, appOrigin));
  const modelOrigin = await listen(model);
  const title = 'Launch: \u201c\u00e9t\u00e9\u201d / \u6771\u4eac \u{1f680}';
  const alice = { id: 'alice', name: 'Alice' };
  const selected: string[] = [];
  let inferenceCount = 0;
  let discovery: 'normal' | 'skipped' | 'late' | 'failed' = 'normal';
  model.on('request', (req, res) => {
    void (async () => {
      inferenceCount++;
      const files = await readdir(runDirectory);
      assert.ok(files.length > 0, 'The task must be durable before inference');
      for (const file of files)
        manifestSchema.parse(
          JSON.parse(await readFile(join(runDirectory, file), 'utf8')),
        );
      let body = '';
      for await (const chunk of req) body += String(chunk);
      const request = agentRequestSchema.parse(JSON.parse(body));
      const createTool = request.tools.find(
        (tool) => tool.name === 'create_draft',
      );
      assert.ok(createTool);
      assert.doesNotMatch(
        JSON.stringify(createTool.inputSchema),
        /operationId|title/,
      );
      const getTool = request.tools.find((tool) => tool.name === 'get_draft');
      assert.ok(getTool);
      assert.doesNotMatch(JSON.stringify(getTool.inputSchema), /"id"/);
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
      if (results.length === 0 && discovery === 'skipped')
        reply = call('create_draft', { projectId: 'marketing' });
      else if (results.length === 0 && discovery === 'late') {
        const create = call('create_draft', { projectId: 'marketing' });
        const search = call('search_projects', {});
        reply = {
          content: null,
          tool_calls: [...create.tool_calls, ...search.tool_calls],
        };
      } else if (results.length === 0)
        reply = call(
          'search_projects',
          discovery === 'failed' ? { query: 'Marketing' } : {},
        );
      else if (results.length === 1)
        reply = call('create_draft', { projectId: 'marketing' });
      else if (results.length === 2) {
        const created = results[1];
        assert.ok(created?.content);
        const result = createDraftResultSchema.parse(
          JSON.parse(created.content),
        );
        assert.equal(result.status, 'completed');
        reply = call('get_draft', {});
      } else reply = { content: 'Created and retrieved.' };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(reply));
    })().catch((error: unknown) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });
  const run = (args: string[], origin = appOrigin) =>
    new Promise<{ error: Error | null; stdout: string; stderr: string }>(
      (resolve) =>
        execFile(
          process.execPath,
          ['--import', 'tsx', 'scripts/run-drafts-agent.ts', ...args],
          {
            env: {
              ...process.env,
              DRAFTS_ORIGIN: origin,
              WORKBENCH_ORIGIN: modelOrigin,
              DRAFTS_PASSWORD: password,
              DRAFTS_RUN_DIR: runDirectory,
            },
            timeout: 15000,
          },
          (error, stdout, stderr) => resolve({ error, stdout, stderr }),
        ),
    );
  const taskFrom = (output: string) => {
    for (const line of output.split('\n')) {
      if (!line.startsWith('{')) continue;
      try {
        const result = taskLocationSchema.safeParse(JSON.parse(line));
        if (result.success) return result.data;
      } catch {
        continue;
      }
    }
    assert.fail(`No task location in output: ${output}`);
  };
  try {
    for (const behavior of ['skipped', 'late', 'failed'] as const) {
      discovery = behavior;
      const rejected = await run([title]);
      assert.ok(rejected.error, `${behavior} discovery must fail`);
      assert.match(
        rejected.stderr,
        /Marketing discovery required before create_draft/,
      );
      assert.equal(store.pending(alice).length, 0);
      assert.equal(store.drafts(alice).length, 0);
    }
    discovery = 'normal';
    selected.length = 0;
    const first = await run([title]);
    assert.ok(first.error);
    assert.match(first.stderr, /Approval requires.*--resume/);
    const task = taskFrom(first.stdout);
    const originalManifest = await readFile(task.taskFile, 'utf8');
    const manifest = manifestSchema.parse(JSON.parse(originalManifest));
    assert.deepEqual(manifest, {
      version: 1,
      operationId: task.operationId,
      title,
      origin: appOrigin,
      before: [],
    });
    assert.equal(store.pending(alice).length, 1);
    assert.equal(store.pending(alice)[0]?.id, task.operationId);
    assert.equal(store.drafts(alice).length, 0);
    assert.deepEqual(selected.splice(0), ['search_projects', 'create_draft']);
    store.approve(alice, task.operationId);
    await close(app);
    store.close();
    store = new DraftStore(database);
    app = createServer();
    await listen(app, Number(new URL(appOrigin).port));
    app.on('request', createApp(store, appOrigin));

    for (let attempt = 0; attempt < 2; attempt++) {
      const resumed = await run(['--resume', task.taskFile]);
      assert.equal(resumed.error, null, resumed.stderr);
      assert.match(resumed.stdout, /"status": "passed"/);
      assert.deepEqual(selected.splice(0), [
        'search_projects',
        'create_draft',
        'get_draft',
      ]);
      assert.equal(store.drafts(alice).length, 1);
      assert.equal(await readFile(task.taskFile, 'utf8'), originalManifest);
    }
    const previousDrafts = draftsSchema.parse(store.drafts(alice));
    discovery = 'skipped';
    const undiscoveredResume = await run(['--resume', task.taskFile]);
    assert.ok(undiscoveredResume.error);
    assert.match(
      undiscoveredResume.stderr,
      /Marketing discovery required before create_draft/,
    );
    assert.deepEqual(draftsSchema.parse(store.drafts(alice)), previousDrafts);
    discovery = 'normal';
    const second = await run([title]);
    assert.ok(second.error);
    assert.match(second.stderr, /Approval requires.*--resume/);
    const otherTask = taskFrom(second.stdout);
    assert.notEqual(otherTask.operationId, task.operationId);
    assert.notEqual(otherTask.taskFile, task.taskFile);
    const otherManifest = manifestSchema.parse(
      JSON.parse(await readFile(otherTask.taskFile, 'utf8')),
    );
    assert.deepEqual(otherManifest.before, previousDrafts);
    assert.equal(store.pending(alice)[0]?.id, otherTask.operationId);
    store.approve(alice, otherTask.operationId);
    const secondResume = await run(['--resume', otherTask.taskFile]);
    assert.equal(secondResume.error, null, secondResume.stderr);
    assert.match(secondResume.stdout, /"status": "passed"/);
    assert.equal(store.drafts(alice).length, 2);
    assert.equal(new Set(store.drafts(alice).map((draft) => draft.id)).size, 2);

    selected.length = 0;
    const firstAfterSecond = await run(['--resume', task.taskFile]);
    assert.equal(firstAfterSecond.error, null, firstAfterSecond.stderr);
    assert.match(firstAfterSecond.stdout, /"status": "passed"/);
    assert.deepEqual(selected, [
      'search_projects',
      'create_draft',
      'get_draft',
    ]);
    assert.equal(store.drafts(alice).length, 2);
    assert.equal(await readFile(task.taskFile, 'utf8'), originalManifest);

    const beforeInvalid = inferenceCount;
    const wrongOrigin = await run(
      ['--resume', task.taskFile],
      'http://127.0.0.1:1',
    );
    assert.ok(wrongOrigin.error);
    assert.match(wrongOrigin.stderr, /origin/i);
    const withTitle = await run(['--resume', task.taskFile, title]);
    assert.ok(withTitle.error);
    const invalidFile = join(directory, 'invalid.json');
    for (const invalid of [
      '{',
      JSON.stringify({ ...manifest, operationId: 'not-a-uuid' }),
      JSON.stringify({ ...manifest, version: 2 }),
      JSON.stringify({ ...manifest, before: [{}] }),
    ]) {
      await writeFile(invalidFile, invalid);
      assert.ok((await run(['--resume', invalidFile])).error);
    }
    assert.equal(inferenceCount, beforeInvalid);
    assert.equal(store.drafts(alice).length, 2);
  } finally {
    await Promise.all([close(app), close(model)]);
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
