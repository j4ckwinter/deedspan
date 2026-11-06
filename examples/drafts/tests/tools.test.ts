import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolRegistry } from 'deedspan';
import { registerDraftTools, registerDraftTaskTools } from '../src/tools.js';
import { DraftStore } from '../src/store.js';
import { createDraftSchema, draftSchema } from '../src/contracts.js';

test('a failed UI refresh cannot discard a completed operation result', async () => {
  const result = {
    status: 'completed',
    operationId: crypto.randomUUID(),
    draftId: crypto.randomUUID(),
  };
  let calls = 0;
  const registry = new ToolRegistry({
    onTrace: async () => {
      throw new Error('Refresh failed');
    },
  });
  registerDraftTools(registry, async (path, _input, callId) => {
    assert.equal(path, '/drafts');
    assert.ok(callId);
    calls++;
    return result;
  });
  const trace = await registry.call('create_draft', {
    operationId: result.operationId,
    projectId: 'marketing',
    title: 'Saved once',
  });
  assert.equal(trace.status, 'success');
  assert.deepEqual(trace.output, result);
  assert.equal(calls, 1);
});

test('task tools bind saved title and identity, reject overrides, and restore retrieval on replay', async () => {
  const store = new DraftStore(':memory:');
  const alice = { id: 'alice', name: 'Alice' };
  const task = {
    operationId: crypto.randomUUID(),
    title: 'Launch: \u201c\u00e9t\u00e9\u201d / \u6771\u4eac \u{1f680}',
  };
  const requests: string[] = [];
  const callIds: string[] = [];
  const makeRegistry = (savedTask = task) => {
    const registry = new ToolRegistry();
    registerDraftTaskTools(
      registry,
      async (path, input, callId) => {
        requests.push(path);
        assert.ok(callId);
        callIds.push(callId);
        if (path === '/drafts') {
          const operation = store.create(alice, createDraftSchema.parse(input));
          return {
            operationId: operation.id,
            status:
              operation.status === 'completed'
                ? 'completed'
                : 'confirmation_required',
            draftId: operation.draft_id,
          };
        }
        return store.draft(
          alice,
          decodeURIComponent(path.slice('/drafts/'.length)),
        );
      },
      savedTask,
    );
    return registry;
  };
  try {
    store.seed('task-tools-test');
    const registry = makeRegistry();
    const descriptors = registry.list();
    const create = descriptors.find((tool) => tool.name === 'create_draft');
    const get = descriptors.find((tool) => tool.name === 'get_draft');
    assert.ok(create);
    assert.ok(get);
    assert.doesNotMatch(
      JSON.stringify(create.inputSchema),
      /operationId|title/,
    );
    assert.doesNotMatch(JSON.stringify(get.inputSchema), /"id"/);
    assert.equal((await registry.call('get_draft', {})).status, 'error');
    assert.deepEqual(requests, []);
    for (const override of [
      { title: 'Injected' },
      { operationId: crypto.randomUUID() },
    ]) {
      assert.equal(
        (
          await registry.call('create_draft', {
            projectId: 'marketing',
            ...override,
          })
        ).status,
        'error',
      );
    }
    assert.deepEqual(requests, []);
    for (let attempt = 0; attempt < 2; attempt++) {
      const pending = await registry.call('create_draft', {
        projectId: 'marketing',
      });
      assert.equal(pending.status, 'success');
      assert.deepEqual(pending.output, {
        operationId: task.operationId,
        status: 'confirmation_required',
        draftId: null,
      });
    }
    assert.equal(store.pending(alice).length, 1);
    assert.equal(store.pending(alice)[0]?.title, task.title);
    assert.equal((await registry.call('get_draft', {})).status, 'error');
    assert.deepEqual(requests, ['/drafts', '/drafts']);
    store.approve(alice, task.operationId);
    const completed = await registry.call('create_draft', {
      projectId: 'marketing',
    });
    assert.equal(completed.status, 'success');
    const saved = draftSchema.parse(store.drafts(alice)[0]);
    assert.ok(saved);
    assert.equal(
      (await registry.call('get_draft', { id: crypto.randomUUID() })).status,
      'error',
    );
    assert.deepEqual(requests, ['/drafts', '/drafts', '/drafts']);
    const retrieved = await registry.call('get_draft', {});
    assert.equal(retrieved.status, 'success');
    assert.deepEqual(retrieved.output, saved);
    assert.equal(requests.at(-1), `/drafts/${String(saved.id)}`);

    const resumed = makeRegistry();
    const count = requests.length;
    assert.equal((await resumed.call('get_draft', {})).status, 'error');
    assert.equal(requests.length, count);
    assert.equal(
      (await resumed.call('create_draft', { projectId: 'marketing' })).status,
      'success',
    );
    assert.deepEqual((await resumed.call('get_draft', {})).output, saved);
    assert.equal(store.drafts(alice).length, 1);

    const otherTask = { ...task, operationId: crypto.randomUUID() };
    const other = makeRegistry(otherTask);
    assert.equal((await other.call('get_draft', {})).status, 'error');
    assert.equal(
      (await other.call('create_draft', { projectId: 'marketing' })).status,
      'success',
    );
    store.approve(alice, otherTask.operationId);
    assert.equal(
      (await other.call('create_draft', { projectId: 'marketing' })).status,
      'success',
    );
    const otherDraft = await other.call('get_draft', {});
    assert.equal(otherDraft.status, 'success');
    assert.notDeepEqual(otherDraft.output, saved);
    assert.equal(store.drafts(alice).length, 2);
    assert.deepEqual(
      store.drafts(alice).map((draft) => draft.title),
      [task.title, task.title],
    );
    assert.deepEqual((await resumed.call('get_draft', {})).output, saved);
    assert.equal(new Set(callIds).size, callIds.length);
  } finally {
    store.close();
  }
});

test('malformed or unrelated completed responses cannot authorize task retrieval', async () => {
  const task = { operationId: crypto.randomUUID(), title: 'Saved title' };
  const draftId = crypto.randomUUID();
  for (const response of [
    { status: 'completed', operationId: task.operationId, draftId: null },
    {
      status: 'completed',
      operationId: task.operationId,
      draftId: 'not-a-uuid',
    },
    { status: 'completed', operationId: crypto.randomUUID(), draftId },
    { status: 'completed', draftId },
  ]) {
    const registry = new ToolRegistry();
    const paths: string[] = [];
    registerDraftTaskTools(
      registry,
      async (path) => {
        paths.push(path);
        return response;
      },
      task,
    );
    assert.equal(
      (await registry.call('create_draft', { projectId: 'marketing' })).status,
      'error',
    );
    assert.equal((await registry.call('get_draft', {})).status, 'error');
    assert.deepEqual(paths, ['/drafts']);
  }
});
