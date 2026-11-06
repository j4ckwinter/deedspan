import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolRegistry } from 'short-stack';
import { registerDraftTools } from '../src/tools.js';

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
