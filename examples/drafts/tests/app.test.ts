import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import { DraftStore } from '../src/store.js';

const password = 'example-password-for-tests';
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'deedspan-drafts-'));
  const store = new DraftStore(join(directory, 'drafts.sqlite'));
  store.seed(password);
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
    const { csrf } = (await response.json()) as { csrf: string };
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    return async (
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      fetch(`${origin}/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Origin: origin,
          Cookie: cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
  }
  return {
    store,
    origin,
    login,
    path: join(directory, 'drafts.sqlite'),
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('confirmation, retries, audit correlation and persistent outcome', async () => {
  const f = await fixture();
  try {
    const alice = await f.login('alice');
    const input = {
      operationId: randomUUID(),
      projectId: 'marketing',
      title: 'November launch notes',
    };
    const callId = randomUUID();
    const pending = await alice('/drafts', input, { 'X-Tool-Call-Id': callId });
    assert.equal((await pending.json()).status, 'confirmation_required');
    assert.deepEqual(await (await alice('/drafts')).json(), []);
    assert.equal(
      (await alice(`/approvals/${input.operationId}`, {})).status,
      200,
    );
    const response = await (await alice('/drafts', input)).json();
    assert.equal(response.status, 'completed');
    const retries = await Promise.all(
      Array.from({ length: 5 }, () => alice('/drafts', input)),
    );
    for (const retry of retries) assert.deepEqual(await retry.json(), response);
    assert.equal((await (await alice('/drafts')).json()).length, 1);
    assert.equal(
      (await (await alice(`/drafts/${response.draftId}`)).json()).title,
      input.title,
    );
    assert.equal(
      (await alice('/drafts', { ...input, title: 'Changed title' })).status,
      409,
    );
    const events = await (await alice('/events')).json();
    assert.deepEqual(
      events.map((e: { outcome: string }) => e.outcome),
      ['confirmation_required', 'approved', 'completed'],
    );
    assert.equal(events[2].draft_id, response.draftId);
    const calls = await (await alice('/calls')).json();
    assert.equal(calls[0].id, callId);
    assert.equal(calls[0].operation_id, input.operationId);
    assert.ok(!JSON.stringify(calls).includes(input.title));
    const reopened = new DraftStore(f.path);
    try {
      assert.equal(reopened.drafts({ id: 'alice', name: 'Alice' }).length, 1);
      const retried = reopened.create({ id: 'alice', name: 'Alice' }, input);
      assert.equal(retried.draft_id, response.draftId);
      assert.equal(reopened.drafts({ id: 'alice', name: 'Alice' }).length, 1);
    } finally {
      reopened.close();
    }
  } finally {
    await f.close();
  }
});

test('backend denies unauthenticated, cross-user, unconfirmed and forged browser requests', async () => {
  const f = await fixture();
  try {
    const alice = await f.login('alice');
    const bob = await f.login('bob');
    const input = {
      operationId: randomUUID(),
      projectId: 'marketing',
      title: 'Protected draft',
    };
    assert.equal((await fetch(`${f.origin}/api/projects`)).status, 401);
    assert.equal((await bob('/drafts', input)).status, 403);
    assert.equal(
      (await alice('/drafts', input, { Origin: 'https://evil.example' }))
        .status,
      403,
    );
    assert.equal(
      (await alice('/drafts', input, { 'X-CSRF-Token': 'forged' })).status,
      403,
    );
    await alice('/drafts', input);
    assert.equal(
      (await bob(`/approvals/${input.operationId}`, {})).status,
      404,
    );
    assert.equal(
      (await alice('/drafts', { ...input, approved: true })).status,
      400,
    );
    assert.equal(
      (await (await alice('/drafts', input)).json()).status,
      'confirmation_required',
    );
    await alice(`/approvals/${input.operationId}`, {});
    const result = await (await alice('/drafts', input)).json();
    assert.equal((await bob(`/drafts/${result.draftId}`)).status, 403);
    assert.deepEqual(await (await bob('/drafts')).json(), []);
    assert.deepEqual(await (await bob('/events')).json(), []);
  } finally {
    await f.close();
  }
});
