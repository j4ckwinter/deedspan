import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Inventory, inventoryTools, reservationSchema } from './inventory.js';

const directory = mkdtempSync(join(tmpdir(), 'inventory-demo-'));
const path = join(directory, 'inventory.sqlite');
const app = new Inventory(path, 'local-demo-password');
try {
  const session = app.login('buyer', 'local-demo-password');
  const tools = inventoryTools(app, session);
  process.stdout.write(
    `${JSON.stringify({ mode: 'deterministic SDK demonstration, no model inference', discovered: tools.list() }, null, 2)}\n`,
  );
  const search = await tools.call('search_available_products', {
    query: 'notebook',
  });
  const input = {
    operationId: randomUUID(),
    productId: 'notebook',
    quantity: 2,
  };
  const reserve = await tools.call('reserve_inventory', input);
  assert.equal(reserve.status, 'success');
  const reservation = reservationSchema.parse(reserve.output);
  const retrieved = await tools.call('get_reservation', {
    reservationId: reservation.id,
  });
  const replay = await tools.call('reserve_inventory', input);
  const denied = await tools.call('reserve_inventory', {
    ...input,
    operationId: randomUUID(),
    quantity: 4,
  });
  assert.equal(denied.status, 'error');
  const db = new DatabaseSync(path);
  try {
    assert.equal(
      db.prepare('SELECT available FROM products WHERE id = ?').get('notebook')
        ?.available,
      3,
    );
    assert.equal(
      db.prepare('SELECT count(*) AS count FROM reservations').get()?.count,
      1,
    );
    process.stdout.write(
      `${JSON.stringify({ traces: [search, reserve, retrieved, replay, denied], persisted: db.prepare('SELECT * FROM reservations').all(), audit: db.prepare('SELECT * FROM audit').all(), verified: true }, null, 2)}\n`,
    );
  } finally {
    db.close();
  }
} finally {
  app.close();
  rmSync(directory, { recursive: true });
}
