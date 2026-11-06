import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { DraftStore } from '../src/store.js';
import {
  draftSchema,
  sessionSchema,
  updateDraftResultSchema,
  updateOperationSchema,
  updateOperationsSchema,
} from '../src/contracts.js';

const aliceUser = { id: 'alice', name: 'Alice' };
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'draft-update-'));
  const path = join(directory, 'drafts.sqlite');
  const store = new DraftStore(path);
  const password = 'update-tests-password';
  store.seed(password);
  const createInput = {
    operationId: randomUUID(),
    projectId: 'marketing',
    title: 'Original title',
  };
  store.create(aliceUser, createInput);
  store.approve(aliceUser, createInput.operationId);
  const created = store.create(aliceUser, createInput);
  assert.ok(created.draft_id);
  const draft = store.draft(aliceUser, created.draft_id);
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  server.on('request', createApp(store, origin));
  async function login(username: string) {
    const response = await fetch(`${origin}/api/login`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(response.status, 200);
    const { csrf } = sessionSchema.parse(await response.json());
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    return (
      route: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      fetch(`${origin}/api${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-CSRF-Token': csrf,
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
  }
  return {
    store,
    path,
    draft,
    createInput,
    origin,
    login,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('an approved update persists once across retries and reopening, with correlated audit evidence', async () => {
  const f = await fixture();
  try {
    const request = await f.login('alice');
    const input = {
      operationId: randomUUID(),
      draftId: f.draft.id,
      expectedVersion: f.draft.version,
      title: 'Café launch — 東京',
    };
    const callId = randomUUID();
    const pending = updateDraftResultSchema.parse(
      await (
        await request('/draft-updates', input, { 'X-Tool-Call-Id': callId })
      ).json(),
    );
    assert.equal(pending.status, 'confirmation_required');
    assert.deepEqual(
      draftSchema.parse(await (await request(`/drafts/${f.draft.id}`)).json()),
      f.draft,
    );
    const approvals = updateOperationsSchema.parse(
      await (await request('/draft-updates/approvals')).json(),
    );
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0]?.previous_title, f.draft.title);
    assert.equal(approvals[0]?.title, input.title);
    assert.equal(approvals[0]?.expected_version, 1);
    assert.equal(
      (await request(`/draft-updates/${input.operationId}/approve`, {})).status,
      200,
    );
    const result = updateDraftResultSchema.parse(
      await (await request('/draft-updates', input)).json(),
    );
    assert.deepEqual(result, {
      operationId: input.operationId,
      status: 'completed',
      draftId: f.draft.id,
      version: 2,
    });
    for (const retry of await Promise.all(
      Array.from({ length: 4 }, () => request('/draft-updates', input)),
    )) {
      assert.deepEqual(
        updateDraftResultSchema.parse(await retry.json()),
        result,
      );
    }
    assert.deepEqual(
      draftSchema.parse(await (await request(`/drafts/${f.draft.id}`)).json()),
      { ...f.draft, title: input.title, version: 2 },
    );
    assert.deepEqual(
      await (await request('/draft-updates/approvals')).json(),
      [],
    );
    const events = z
      .array(z.object({ operation_id: z.string(), outcome: z.string() }))
      .parse(await (await request('/events')).json());
    assert.deepEqual(
      events
        .filter((e) => e.operation_id === input.operationId)
        .map((e) => e.outcome),
      ['update_confirmation_required', 'update_approved', 'update_completed'],
    );
    const calls = z
      .array(z.object({ id: z.string(), operation_id: z.string().nullable() }))
      .parse(await (await request('/calls')).json());
    assert.equal(
      calls.find((c) => c.id === callId)?.operation_id,
      input.operationId,
    );
    const reopened = new DraftStore(f.path);
    try {
      assert.equal(reopened.update(aliceUser, input).result_version, 2);
      assert.equal(reopened.draft(aliceUser, f.draft.id).version, 2);
      assert.equal(reopened.drafts(aliceUser).length, 1);
    } finally {
      reopened.close();
    }
    assert.equal(
      (await request(`/draft-updates/${input.operationId}/reject`, {})).status,
      409,
    );
  } finally {
    await f.close();
  }
});

test('rejection is durable and approval cannot revive it', async () => {
  const f = await fixture();
  try {
    const request = await f.login('alice');
    const input = {
      operationId: randomUUID(),
      draftId: f.draft.id,
      expectedVersion: 1,
      title: 'Rejected title',
    };
    await request('/draft-updates', input);
    const rejected = updateOperationSchema.parse(
      await (
        await request(`/draft-updates/${input.operationId}/reject`, {})
      ).json(),
    );
    assert.equal(rejected.status, 'rejected');
    await request(`/draft-updates/${input.operationId}/approve`, {});
    await request(`/draft-updates/${input.operationId}/reject`, {});
    const result = updateDraftResultSchema.parse(
      await (await request('/draft-updates', input)).json(),
    );
    assert.equal(result.status, 'rejected');
    assert.deepEqual(f.store.draft(aliceUser, f.draft.id), f.draft);
    const reopened = new DraftStore(f.path);
    try {
      assert.equal(reopened.update(aliceUser, input).status, 'rejected');
    } finally {
      reopened.close();
    }
    const outcomes = f.store.events(aliceUser).map((e) => e.outcome);
    assert.equal(outcomes.filter((o) => o === 'update_rejected').length, 1);
    assert.ok(!outcomes.includes('update_completed'));
  } finally {
    await f.close();
  }
});

test('stale requests conflict before approval and after approval without overwriting a newer edit', async () => {
  const f = await fixture();
  try {
    const request = await f.login('alice');
    const first = {
      operationId: randomUUID(),
      draftId: f.draft.id,
      expectedVersion: 1,
      title: 'Winner',
    };
    const approvedLoser = {
      ...first,
      operationId: randomUUID(),
      title: 'Approved loser',
    };
    const pendingLoser = {
      ...first,
      operationId: randomUUID(),
      title: 'Pending loser',
    };
    for (const input of [first, approvedLoser, pendingLoser])
      await request('/draft-updates', input);
    await request(`/draft-updates/${first.operationId}/approve`, {});
    await request(`/draft-updates/${approvedLoser.operationId}/approve`, {});
    assert.equal(
      (await request(`/draft-updates/${approvedLoser.operationId}/reject`, {}))
        .status,
      409,
    );
    const responses = await Promise.all([
      request('/draft-updates', first),
      request('/draft-updates', approvedLoser),
    ]);
    const results = await Promise.all(
      responses.map(async (r) => updateDraftResultSchema.parse(await r.json())),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [
      'completed',
      'conflict',
    ]);
    const winner = results[0]?.status === 'completed' ? first : approvedLoser;
    assert.equal(
      updateOperationSchema.parse(
        await (
          await request(
            `/draft-updates/${pendingLoser.operationId}/approve`,
            {},
          )
        ).json(),
      ).status,
      'conflict',
    );
    const stale = {
      ...first,
      operationId: randomUUID(),
      title: 'Already stale',
    };
    assert.equal(
      updateDraftResultSchema.parse(
        await (await request('/draft-updates', stale)).json(),
      ).status,
      'conflict',
    );
    assert.equal(
      updateDraftResultSchema.parse(
        await (await request('/draft-updates', pendingLoser)).json(),
      ).status,
      'conflict',
    );
    assert.deepEqual(f.store.draft(aliceUser, f.draft.id), {
      ...f.draft,
      title: winner.title,
      version: 2,
    });
    assert.equal(
      f.store.events(aliceUser).filter((e) => e.outcome === 'update_completed')
        .length,
      1,
    );
  } finally {
    await f.close();
  }
});

test('update requests enforce authentication, access, exact payloads and operation identity across workflows', async () => {
  const f = await fixture();
  try {
    const request = await f.login('alice');
    const bob = await f.login('bob');
    const input = {
      operationId: randomUUID(),
      draftId: f.draft.id,
      expectedVersion: 1,
      title: 'Protected update',
    };
    assert.equal(
      (await fetch(`${f.origin}/api/draft-updates/approvals`)).status,
      401,
    );
    assert.equal((await bob('/draft-updates', input)).status, 403);
    assert.equal(
      (await request('/draft-updates', input, { 'X-CSRF-Token': 'forged' }))
        .status,
      403,
    );
    assert.equal(
      (
        await request('/draft-updates', input, {
          Origin: 'https://evil.example',
        })
      ).status,
      403,
    );
    assert.equal(
      (await request('/draft-updates', { ...input, approved: true })).status,
      400,
    );
    assert.equal(
      (await request('/draft-updates', { ...input, expectedVersion: 0 }))
        .status,
      400,
    );
    await request('/draft-updates', input);
    assert.equal(
      (await bob(`/draft-updates/${input.operationId}/approve`, {})).status,
      404,
    );
    assert.equal(
      (await bob(`/draft-updates/${input.operationId}/reject`, {})).status,
      404,
    );
    assert.deepEqual(await (await bob('/draft-updates/approvals')).json(), []);
    for (const changed of [
      { ...input, title: 'Changed' },
      { ...input, expectedVersion: 2 },
    ])
      assert.equal((await request('/draft-updates', changed)).status, 409);
    assert.equal(
      (
        await request('/draft-updates', {
          ...input,
          operationId: f.createInput.operationId,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request('/drafts', {
          ...f.createInput,
          operationId: input.operationId,
        })
      ).status,
      409,
    );
    const connection = new DatabaseSync(f.path);
    try {
      connection
        .prepare('DELETE FROM memberships WHERE user_id = ?')
        .run('alice');
    } finally {
      connection.close();
    }
    assert.equal((await request('/draft-updates', input)).status, 403);
    assert.equal(
      (await request(`/draft-updates/${input.operationId}/approve`, {})).status,
      403,
    );
    assert.equal(
      (await request(`/draft-updates/${input.operationId}/reject`, {})).status,
      403,
    );
    assert.deepEqual(
      await (await request('/draft-updates/approvals')).json(),
      [],
    );
  } finally {
    await f.close();
  }
});

test('existing draft databases migrate to version one without losing records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'draft-migration-'));
  const path = join(directory, 'old.sqlite');
  const id = randomUUID();
  const old = new DatabaseSync(path);
  old.exec(
    'CREATE TABLE drafts(id TEXT PRIMARY KEY, project_id TEXT, title TEXT NOT NULL)',
  );
  old
    .prepare('INSERT INTO drafts VALUES (?, ?, ?)')
    .run(id, 'marketing', 'Existing draft');
  old.close();
  const store = new DraftStore(path);
  try {
    store.seed('migration-test-password');
    assert.deepEqual(store.draft(aliceUser, id), {
      id,
      project_id: 'marketing',
      title: 'Existing draft',
      version: 1,
    });
    const input = {
      operationId: randomUUID(),
      draftId: id,
      expectedVersion: 1,
      title: 'Migrated update',
    };
    store.update(aliceUser, input);
    store.decideUpdate(aliceUser, input.operationId, 'approve');
    assert.equal(store.update(aliceUser, input).result_version, 2);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
