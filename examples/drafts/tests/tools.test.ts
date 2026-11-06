import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolRegistry } from 'deedspan';
import { registerDraftTools, registerDraftTaskTools } from '../src/tools.js';
import { DraftStore } from '../src/store.js';
import { createDraftSchema } from '../src/contracts.js';

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

test('task tools bind operation identity across calls and exclude it from model input', async () => {
  const operationId = crypto.randomUUID();
  const registry = new ToolRegistry();
  const inputs: unknown[] = [];
  const callIds: string[] = [];
  registerDraftTaskTools(
    registry,
    async (path, input, callId) => {
      assert.equal(path, '/drafts');
      assert.ok(callId);
      inputs.push(input);
      callIds.push(callId);
      return { status: 'confirmation_required', operationId, draftId: null };
    },
    operationId,
  );
  const descriptor = registry
    .list()
    .find((tool) => tool.name === 'create_draft');
  assert.ok(descriptor);
  assert.doesNotMatch(JSON.stringify(descriptor.inputSchema), /operationId/);
  const input = { projectId: 'marketing', title: 'Saved once' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const trace = await registry.call('create_draft', input);
    assert.equal(trace.status, 'success');
  }
  assert.deepEqual(inputs, [
    { ...input, operationId },
    { ...input, operationId },
  ]);
  assert.equal(new Set(callIds).size, 2);
  const override = await registry.call('create_draft', {
    ...input,
    operationId: crypto.randomUUID(),
  });
  assert.notEqual(override.status, 'success');
  assert.equal(inputs.length, 2);
});

test('task retries with changed input retain identity and encounter the backend conflict', async () => {
  const store = new DraftStore(':memory:');
  try {
    store.seed('task-tools-test');
    const operationId = crypto.randomUUID();
    const registry = new ToolRegistry();
    const alice = { id: 'alice', name: 'Alice' };
    registerDraftTaskTools(
      registry,
      async (_path, input) =>
        store.create(alice, createDraftSchema.parse(input)),
      operationId,
    );
    assert.equal(
      (
        await registry.call('create_draft', {
          projectId: 'marketing',
          title: 'Original',
        })
      ).status,
      'success',
    );
    const changed = await registry.call('create_draft', {
      projectId: 'marketing',
      title: 'Changed',
    });
    assert.notEqual(changed.status, 'success');
    assert.match(
      JSON.stringify(changed),
      /Operation ID already used for different input/,
    );
    assert.equal(store.pending(alice).length, 1);
    assert.equal(store.pending(alice)[0]?.title, 'Original');
  } finally {
    store.close();
  }
});
