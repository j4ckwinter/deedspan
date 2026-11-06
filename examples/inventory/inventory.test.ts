import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { toolTraceSchema, type ToolTrace } from 'deedspan';
import { Inventory, inventoryTools, reservationSchema } from './inventory.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'inventory-test-'));
  const path = join(dir, 'app.sqlite');
  const app = new Inventory(path, 'test-password');
  const session = app.login('buyer', 'test-password');
  return {
    app,
    path,
    session,
    close: () => {
      app.close();
      rmSync(dir, { recursive: true });
    },
  };
}

test('packed SDK discovers, validates, reserves, replays and correlates durable state', async () => {
  const f = fixture();
  try {
    const observed: ToolTrace[] = [];
    const tools = inventoryTools(f.app, f.session, {
      onTrace: (trace) => {
        observed.push(trace);
      },
    });
    assert.deepEqual(
      tools.list().map((tool) => tool.name),
      ['search_available_products', 'reserve_inventory', 'get_reservation'],
    );
    assert.equal(
      (await tools.call('search_available_products', { query: 'notebook' }))
        .status,
      'success',
    );
    const input = {
      operationId: randomUUID(),
      productId: 'notebook',
      quantity: 2,
    };
    const bad = await tools.call('reserve_inventory', {
      ...input,
      quantity: -1,
    });
    assert.equal(bad.status, 'error');
    const first = await tools.call('reserve_inventory', input);
    assert.equal(first.status, 'success');
    const saved = reservationSchema.parse(first.output);
    assert.deepEqual(
      (await tools.call('reserve_inventory', input)).output,
      saved,
    );
    const conflict = await tools.call('reserve_inventory', {
      ...input,
      quantity: 1,
    });
    assert.equal(conflict.status, 'error');
    assert.match(JSON.stringify(conflict.output), /OPERATION_CONFLICT/);
    assert.deepEqual(
      (await tools.call('get_reservation', { reservationId: saved.id })).output,
      saved,
    );
    const reopened = new Inventory(f.path, 'test-password');
    try {
      assert.deepEqual(reopened.get(f.session, saved.id), saved);
      assert.deepEqual(
        reopened.reserve(f.session, input, 'reopened-retry'),
        saved,
      );
    } finally {
      reopened.close();
    }
    const db = new DatabaseSync(f.path);
    try {
      assert.equal(
        db
          .prepare('SELECT available FROM products WHERE id = ?')
          .get('notebook')?.available,
        3,
      );
      assert.equal(
        db.prepare('SELECT count(*) AS count FROM reservations').get()?.count,
        1,
      );
      assert.equal(
        db.prepare('SELECT outcome FROM audit WHERE call_id = ?').get(first.id)
          ?.outcome,
        'reserved',
      );
      assert.equal(
        db
          .prepare('SELECT count(*) AS count FROM audit WHERE call_id = ?')
          .get(bad.id)?.count,
        0,
      );
    } finally {
      db.close();
    }
    assert.ok(
      observed.every((trace) => trace.input === null && trace.output === null),
    );
  } finally {
    f.close();
  }
});

test('application authority rejects viewer and forged session when SDK is bypassed', async () => {
  const f = fixture();
  try {
    const viewer = f.app.login('viewer', 'test-password');
    const input = {
      operationId: randomUUID(),
      productId: 'notebook',
      quantity: 1,
    };
    assert.throws(() => f.app.reserve(viewer, input, 'direct'), /FORBIDDEN/);
    assert.throws(
      () => f.app.reserve('forged-session', input, 'forged'),
      /UNAUTHENTICATED/,
    );
    assert.throws(
      () => f.app.reserve(f.session, { ...input, quantity: 0 }, 'invalid'),
      /Too small/,
    );
    const trace = await inventoryTools(f.app, viewer).call(
      'reserve_inventory',
      input,
    );
    assert.equal(trace.status, 'error');
    assert.match(JSON.stringify(trace.output), /FORBIDDEN/);
    const db = new DatabaseSync(f.path);
    try {
      assert.match(
        String(
          db
            .prepare('SELECT outcome FROM audit WHERE call_id = ?')
            .get(trace.id)?.outcome,
        ),
        /FORBIDDEN/,
      );
      assert.equal(
        db
          .prepare('SELECT available FROM products WHERE id = ?')
          .get('notebook')?.available,
        5,
      );
    } finally {
      db.close();
    }
  } finally {
    f.close();
  }
});

test('competing processes cannot oversell finite stock', async () => {
  const f = fixture();
  try {
    const run = () =>
      new Promise<ToolTrace>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', 'competing-worker.ts'],
          {
            cwd: import.meta.dirname,
            env: {
              ...process.env,
              INVENTORY_DB: f.path,
              INVENTORY_SESSION: f.session,
              INVENTORY_OPERATION: randomUUID(),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let output = '';
        let errors = '';
        child.stdout.setEncoding('utf8').on('data', (chunk) => {
          output += chunk;
        });
        child.stderr.setEncoding('utf8').on('data', (chunk) => {
          errors += chunk;
        });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(errors));
            return;
          }
          try {
            resolve(toolTraceSchema.parse(JSON.parse(output)));
          } catch (error) {
            reject(error);
          }
        });
      });
    const traces = await Promise.all([run(), run()]);
    assert.deepEqual(traces.map((trace) => trace.status).sort(), [
      'error',
      'success',
    ]);
    assert.match(
      JSON.stringify(traces.find((trace) => trace.status === 'error')?.output),
      /INSUFFICIENT_STOCK/,
    );
    const db = new DatabaseSync(f.path);
    try {
      assert.equal(
        db
          .prepare('SELECT available FROM products WHERE id = ?')
          .get('notebook')?.available,
        1,
      );
      assert.equal(
        db.prepare('SELECT count(*) AS count FROM reservations').get()?.count,
        1,
      );
      assert.equal(
        db.prepare('SELECT count(*) AS count FROM audit').get()?.count,
        2,
      );
    } finally {
      db.close();
    }
  } finally {
    f.close();
  }
});

test('task constraints produce SDK error traces and allow a corrected retry', async () => {
  const f = fixture();
  try {
    const operationId = randomUUID();
    const tools = inventoryTools(f.app, f.session, {}, (input) => {
      assert.equal(
        input.operationId,
        operationId,
        'Task operation ID must be preserved',
      );
      assert.equal(input.quantity, 2, 'Task requires two units');
    });
    const rejected = await tools.call('reserve_inventory', {
      operationId,
      productId: 'notebook',
      quantity: 3,
    });
    assert.equal(rejected.status, 'error');
    assert.match(JSON.stringify(rejected.output), /Task requires two units/);
    const corrected = await tools.call('reserve_inventory', {
      operationId,
      productId: 'notebook',
      quantity: 2,
    });
    assert.equal(corrected.status, 'success');
    const saved = reservationSchema.parse(corrected.output);
    assert.throws(
      () => f.app.get(f.app.login('viewer', 'test-password'), saved.id),
      /NOT_FOUND/,
    );
    assert.equal(f.app.search(f.session, 'notebook')[0]?.available, 3);
  } finally {
    f.close();
  }
});
