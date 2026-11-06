import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolRegistry } from 'deedspan';
import { DraftStore } from '../src/store.js';
import { draftSchema, updateDraftSchema } from '../src/contracts.js';
import { registerDraftUpdateTaskTools } from '../src/update-tools.js';

test('update task discovers before writing, binds input and verifies the saved version', async () => {
  const store = new DraftStore(':memory:');
  const user = { id: 'alice', name: 'Alice' };
  store.seed('update-tools-test-password');
  const creation = {
    operationId: crypto.randomUUID(),
    projectId: 'marketing',
    title: 'Existing launch',
  };
  store.create(user, creation);
  store.approve(user, creation.operationId);
  const created = store.create(user, creation);
  assert.ok(created.draft_id);
  const before = draftSchema.parse(store.draft(user, created.draft_id));
  const task = {
    operationId: crypto.randomUUID(),
    title: 'Été / 東京 🚀',
    query: 'Existing',
  };
  const requests: string[] = [];
  const registry = new ToolRegistry();
  registerDraftUpdateTaskTools(
    registry,
    async (path, body, callId) => {
      assert.ok(callId);
      requests.push(path);
      if (path === '/drafts') return store.drafts(user);
      if (path === '/draft-updates') {
        const operation = store.update(user, updateDraftSchema.parse(body));
        return {
          operationId: operation.id,
          status:
            operation.status === 'pending' || operation.status === 'approved'
              ? 'confirmation_required'
              : operation.status,
          draftId: operation.draft_id,
          version: operation.result_version,
        };
      }
      return store.draft(user, path.slice('/drafts/'.length));
    },
    task,
  );
  try {
    assert.equal(
      (await registry.call('update_draft', { id: before.id })).status,
      'error',
    );
    assert.equal(
      (await registry.call('get_updated_draft', {})).status,
      'error',
    );
    assert.deepEqual(requests, []);
    const discovery = await registry.call('search_drafts', {});
    assert.deepEqual(discovery.output, [before]);
    for (const override of [
      { title: 'Other' },
      { expectedVersion: 999 },
      { operationId: crypto.randomUUID() },
    ]) {
      assert.equal(
        (await registry.call('update_draft', { id: before.id, ...override }))
          .status,
        'error',
      );
    }
    const pending = await registry.call('update_draft', { id: before.id });
    assert.equal(pending.status, 'success');
    assert.equal(
      draftSchema.parse(store.draft(user, before.id)).title,
      before.title,
    );
    assert.equal(
      (await registry.call('get_updated_draft', {})).status,
      'error',
    );
    store.decideUpdate(user, task.operationId, 'approve');
    const completed = await registry.call('update_draft', { id: before.id });
    assert.equal(completed.status, 'success');
    await registry.call('search_drafts', {});
    assert.deepEqual(
      (await registry.call('update_draft', { id: before.id })).output,
      completed.output,
    );
    const retrieved = await registry.call('get_updated_draft', {});
    assert.equal(retrieved.status, 'success');
    assert.deepEqual(retrieved.output, {
      ...before,
      title: task.title,
      version: before.version + 1,
    });
    assert.equal(
      (await registry.call('get_updated_draft', { id: before.id })).status,
      'error',
    );
    assert.equal(
      (await registry.call('update_draft', { id: crypto.randomUUID() })).status,
      'error',
    );
    assert.equal(store.drafts(user).length, 1);
  } finally {
    store.close();
  }
});

test('task rejects mismatched responses and changed saved state', async () => {
  const id = crypto.randomUUID();
  const task = {
    operationId: crypto.randomUUID(),
    title: 'New title',
    query: 'Original',
  };
  for (const mismatch of [
    'operation',
    'draft',
    'version',
    'retrieval',
  ] as const) {
    const registry = new ToolRegistry();
    registerDraftUpdateTaskTools(
      registry,
      async (path) => {
        if (path === '/drafts')
          return [
            { id, title: 'Original', project_id: 'marketing', version: 1 },
          ];
        if (path === '/draft-updates')
          return {
            operationId:
              mismatch === 'operation' ? crypto.randomUUID() : task.operationId,
            draftId: mismatch === 'draft' ? crypto.randomUUID() : id,
            version: mismatch === 'version' ? 3 : 2,
            status: 'completed',
          };
        return {
          id,
          title: 'Changed by someone else',
          project_id: 'marketing',
          version: 3,
        };
      },
      task,
    );
    await registry.call('search_drafts', {});
    assert.equal(
      (await registry.call('update_draft', { id })).status,
      mismatch === 'retrieval' ? 'success' : 'error',
    );
    assert.equal(
      (await registry.call('get_updated_draft', {})).status,
      'error',
    );
  }
});
