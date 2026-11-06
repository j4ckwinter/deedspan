import { randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ToolRegistry, type RegistryOptions } from 'deedspan';

export const reserveInput = z
  .object({
    operationId: z.string().uuid(),
    productId: z.string().min(1),
    quantity: z.number().int().min(1).max(100),
  })
  .strict();
const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  available: z.number(),
});
export const reservationSchema = z.object({
  id: z.string(),
  operationId: z.string(),
  actorId: z.string(),
  productId: z.string(),
  quantity: z.number(),
});
const actorSchema = z.object({
  id: z.string(),
  role: z.enum(['buyer', 'viewer']),
});
const reservationColumns =
  'id, operation_id AS operationId, actor_id AS actorId, product_id AS productId, quantity';

export class Inventory {
  private readonly db: DatabaseSync;

  constructor(
    path: string,
    private readonly localPassword: string,
  ) {
    if (!localPassword) throw new Error('Set a local demonstration password');
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA busy_timeout = 10000;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS actors (id TEXT PRIMARY KEY, role TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES actors(id));
      CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, available INTEGER NOT NULL CHECK (available >= 0));
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY, operation_id TEXT UNIQUE NOT NULL,
        actor_id TEXT NOT NULL REFERENCES actors(id), product_id TEXT NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0));
      CREATE TABLE IF NOT EXISTS audit (sequence INTEGER PRIMARY KEY, call_id TEXT NOT NULL, operation_id TEXT NOT NULL, actor_id TEXT NOT NULL, outcome TEXT NOT NULL);
      INSERT OR IGNORE INTO actors VALUES ('buyer', 'buyer'), ('viewer', 'viewer');
      INSERT OR IGNORE INTO products VALUES ('notebook', 'Recycled notebook', 5), ('pencil', 'Graphite pencil', 20);
    `);
  }

  login(actorId: string, password: string) {
    const supplied = Buffer.from(password);
    const expected = Buffer.from(this.localPassword);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new Error('UNAUTHENTICATED: incorrect local password');
    actorSchema.parse(
      this.db.prepare('SELECT * FROM actors WHERE id = ?').get(actorId),
    );
    const token = randomUUID();
    this.db.prepare('INSERT INTO sessions VALUES (?, ?)').run(token, actorId);
    return token;
  }

  private actor(token: string) {
    const row = this.db
      .prepare(
        'SELECT a.* FROM actors a JOIN sessions s ON a.id = s.actor_id WHERE s.token = ?',
      )
      .get(token);
    if (!row) throw new Error('UNAUTHENTICATED: application session required');
    return actorSchema.parse(row);
  }

  search(token: string, query: string) {
    this.actor(token);
    const term = z.string().min(1).max(100).parse(query).toLowerCase();
    return this.db
      .prepare('SELECT * FROM products WHERE available > 0 ORDER BY id')
      .all()
      .map((row) => productSchema.parse(row))
      .filter((row) => row.name.toLowerCase().includes(term));
  }

  reserve(token: string, raw: unknown, callId: string) {
    const input = reserveInput.parse(raw);
    const actor = this.actor(token);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (actor.role !== 'buyer')
        throw new Error('FORBIDDEN: only buyers may reserve stock');
      const existing = this.db
        .prepare(
          `SELECT ${reservationColumns} FROM reservations WHERE operation_id = ?`,
        )
        .get(input.operationId);
      if (existing) {
        const reservation = reservationSchema.parse(existing);
        if (
          reservation.actorId !== actor.id ||
          reservation.productId !== input.productId ||
          reservation.quantity !== input.quantity
        ) {
          throw new Error(
            'OPERATION_CONFLICT: retry must preserve actor, product and quantity',
          );
        }
        this.audit(callId, input.operationId, actor.id, 'replayed');
        this.db.exec('COMMIT');
        return reservation;
      }
      const changed = this.db
        .prepare(
          'UPDATE products SET available = available - ? WHERE id = ? AND available >= ?',
        )
        .run(input.quantity, input.productId, input.quantity);
      if (changed.changes !== 1)
        throw new Error(
          'INSUFFICIENT_STOCK: product missing or requested quantity unavailable',
        );
      const reservation = { id: randomUUID(), ...input, actorId: actor.id };
      this.db
        .prepare('INSERT INTO reservations VALUES (?, ?, ?, ?, ?)')
        .run(
          reservation.id,
          reservation.operationId,
          actor.id,
          reservation.productId,
          reservation.quantity,
        );
      this.audit(callId, input.operationId, actor.id, 'reserved');
      this.db.exec('COMMIT');
      return reservation;
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.audit(
        callId,
        input.operationId,
        actor.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  get(token: string, id: string) {
    const actor = this.actor(token);
    const row = this.db
      .prepare(
        `SELECT ${reservationColumns} FROM reservations WHERE id = ? AND actor_id = ?`,
      )
      .get(id, actor.id);
    if (!row)
      throw new Error('NOT_FOUND: no reservation visible to this actor');
    return reservationSchema.parse(row);
  }

  private audit(
    callId: string,
    operationId: string,
    actorId: string,
    outcome: string,
  ) {
    this.db
      .prepare(
        'INSERT INTO audit (call_id, operation_id, actor_id, outcome) VALUES (?, ?, ?, ?)',
      )
      .run(callId, operationId, actorId, outcome);
  }

  close() {
    this.db.close();
  }
}

export function inventoryTools(
  app: Inventory,
  session: string,
  options: RegistryOptions = {},
  beforeReserve?: (input: z.infer<typeof reserveInput>) => void,
) {
  const tools = new ToolRegistry(options);
  tools.register({
    name: 'search_available_products',
    description:
      'Find available products whose name contains query, using case-insensitive literal substring matching. Use a short keyword, for example {"query":"notebook"}. If there are no matches, try a shorter keyword.',
    input: z.object({ query: z.string().min(1).max(100) }).strict(),
    execute: ({ query }) => app.search(session, query),
  });
  tools.register({
    name: 'reserve_inventory',
    description:
      'Reserve finite stock. Reuse the same operationId, productId and quantity when retrying. Only buyers may reserve.',
    input: reserveInput,
    execute: (input, context) => {
      beforeReserve?.(input);
      return app.reserve(session, input, context.callId);
    },
  });
  tools.register({
    name: 'get_reservation',
    description: 'Retrieve your saved reservation by ID.',
    input: z.object({ reservationId: z.string().uuid() }).strict(),
    execute: ({ reservationId }) => app.get(session, reservationId),
  });
  return tools;
}
