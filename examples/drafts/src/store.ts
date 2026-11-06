import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  draftSchema,
  updateOperationSchema,
  type UpdateDraftInput,
} from './contracts.js';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface User {
  id: string;
  name: string;
}
export interface Operation {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  status: 'pending' | 'approved' | 'completed';
  draft_id: string | null;
}
export class DraftStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, hash BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships(user_id TEXT REFERENCES users(id), project_id TEXT REFERENCES projects(id), PRIMARY KEY(user_id, project_id));
      CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), title TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), project_id TEXT REFERENCES projects(id), title TEXT NOT NULL, status TEXT NOT NULL, draft_id TEXT REFERENCES drafts(id));
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, operation_id TEXT, method TEXT NOT NULL, path TEXT NOT NULL, status INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, operation_id TEXT, outcome TEXT NOT NULL, draft_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS draft_updates(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), project_id TEXT NOT NULL REFERENCES projects(id), draft_id TEXT NOT NULL REFERENCES drafts(id), expected_version INTEGER NOT NULL, previous_title TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, result_version INTEGER);
    `);
    if (
      !this.db
        .prepare('PRAGMA table_info(drafts)')
        .all()
        .some((column) => column.name === 'version')
    ) {
      this.db.exec(
        'ALTER TABLE drafts ADD COLUMN version INTEGER NOT NULL DEFAULT 1',
      );
    }
  }
  seed(password: string) {
    for (const [id, name] of [
      ['alice', 'Alice'],
      ['bob', 'Bob'],
    ] as const) {
      const salt = randomBytes(16).toString('hex');
      this.db
        .prepare('INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?)')
        .run(id, name, salt, scryptSync(password, salt, 64));
    }
    this.db
      .exec(`INSERT OR IGNORE INTO projects VALUES ('marketing', 'Marketing'), ('engineering', 'Engineering');
      INSERT OR IGNORE INTO memberships VALUES ('alice', 'marketing'), ('bob', 'engineering');`);
  }
  login(id: string, password: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      (User & { salt: string; hash: Uint8Array }) | undefined;
    const actual = scryptSync(password, row?.salt ?? 'unknown-user-salt', 64);
    return row && timingSafeEqual(actual, row.hash)
      ? { id: row.id, name: row.name }
      : undefined;
  }
  projects(user: User) {
    return this.db
      .prepare(
        'SELECT p.id, p.name FROM projects p JOIN memberships m ON p.id = m.project_id WHERE m.user_id = ?',
      )
      .all(user.id);
  }
  private requireAccess(user: User, project: string) {
    if (
      !this.db
        .prepare(
          'SELECT 1 FROM memberships WHERE user_id = ? AND project_id = ?',
        )
        .get(user.id, project)
    )
      throw new AppError(403, 'Project access denied');
  }
  private operation(user: User, id: string): Operation {
    const operation = this.db
      .prepare('SELECT * FROM operations WHERE id = ? AND user_id = ?')
      .get(id, user.id) as unknown as Operation | undefined;
    if (!operation) throw new AppError(404, 'Operation not found');
    this.requireAccess(user, operation.project_id);
    return operation;
  }
  private event(
    user: User,
    operation: Pick<Operation, 'id'>,
    outcome: string,
    draftId: string | null = null,
  ) {
    this.db
      .prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        randomUUID(),
        user.id,
        operation.id,
        outcome,
        draftId,
        new Date().toISOString(),
      );
  }
  create(
    user: User,
    input: { operationId: string; projectId: string; title: string },
  ) {
    this.requireAccess(user, input.projectId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (
        this.db
          .prepare('SELECT 1 FROM draft_updates WHERE id = ?')
          .get(input.operationId)
      )
        throw new AppError(
          409,
          'Operation ID already used for different input',
        );
      const existing = this.db
        .prepare('SELECT * FROM operations WHERE id = ?')
        .get(input.operationId) as unknown as Operation | undefined;
      if (
        existing &&
        (existing.user_id !== user.id ||
          existing.project_id !== input.projectId ||
          existing.title !== input.title)
      )
        throw new AppError(
          409,
          'Operation ID already used for different input',
        );
      if (!existing) {
        this.db
          .prepare('INSERT INTO operations VALUES (?, ?, ?, ?, ?, NULL)')
          .run(
            input.operationId,
            user.id,
            input.projectId,
            input.title,
            'pending',
          );
      }
      const operation = this.operation(user, input.operationId);
      if (!existing) this.event(user, operation, 'confirmation_required');
      if (operation.status === 'approved') {
        const draftId = randomUUID();
        this.db
          .prepare(
            'INSERT INTO drafts (id, project_id, title) VALUES (?, ?, ?)',
          )
          .run(draftId, input.projectId, input.title);
        this.db
          .prepare(
            "UPDATE operations SET status = 'completed', draft_id = ? WHERE id = ?",
          )
          .run(draftId, operation.id);
        this.event(user, operation, 'completed', draftId);
      }
      const result = this.operation(user, input.operationId);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  approve(user: User, id: string) {
    const operation = this.operation(user, id);
    if (operation.status === 'pending') {
      this.db
        .prepare("UPDATE operations SET status = 'approved' WHERE id = ?")
        .run(id);
      this.event(user, operation, 'approved');
    }
    return this.operation(user, id);
  }
  pending(user: User) {
    return this.db
      .prepare(
        "SELECT o.* FROM operations o JOIN memberships m ON o.project_id = m.project_id AND o.user_id = m.user_id WHERE o.user_id = ? AND o.status = 'pending'",
      )
      .all(user.id);
  }
  draft(user: User, id: string) {
    const draft = this.db.prepare('SELECT * FROM drafts WHERE id = ?').get(id);
    if (!draft) throw new AppError(404, 'Draft not found');
    this.requireAccess(user, String(draft.project_id));
    return draftSchema.parse(draft);
  }
  private updateOperation(user: User, id: string) {
    const row = this.db
      .prepare('SELECT * FROM draft_updates WHERE id = ? AND user_id = ?')
      .get(id, user.id);
    if (!row) throw new AppError(404, 'Update operation not found');
    const operation = updateOperationSchema.parse(row);
    this.requireAccess(user, operation.project_id);
    return operation;
  }
  update(user: User, input: UpdateDraftInput) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const draft = this.draft(user, input.draftId);
      if (
        this.db
          .prepare('SELECT 1 FROM operations WHERE id = ?')
          .get(input.operationId)
      )
        throw new AppError(
          409,
          'Operation ID already used for different input',
        );
      const row = this.db
        .prepare('SELECT * FROM draft_updates WHERE id = ?')
        .get(input.operationId);
      const existing = row ? updateOperationSchema.parse(row) : undefined;
      if (
        existing &&
        (existing.user_id !== user.id ||
          existing.draft_id !== input.draftId ||
          existing.expected_version !== input.expectedVersion ||
          existing.title !== input.title)
      )
        throw new AppError(
          409,
          'Operation ID already used for different input',
        );
      if (!existing) {
        const status =
          draft.version === input.expectedVersion ? 'pending' : 'conflict';
        this.db
          .prepare(
            'INSERT INTO draft_updates VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)',
          )
          .run(
            input.operationId,
            user.id,
            draft.project_id,
            draft.id,
            input.expectedVersion,
            draft.title,
            input.title,
            status,
          );
        this.event(
          user,
          { id: input.operationId },
          status === 'pending'
            ? 'update_confirmation_required'
            : 'update_conflict',
          draft.id,
        );
      }
      const operation = this.updateOperation(user, input.operationId);
      if (operation.status === 'approved') {
        if (draft.version !== operation.expected_version) {
          this.db
            .prepare(
              "UPDATE draft_updates SET status = 'conflict' WHERE id = ?",
            )
            .run(operation.id);
          this.event(user, operation, 'update_conflict', draft.id);
        } else {
          this.db
            .prepare(
              'UPDATE drafts SET title = ?, version = version + 1 WHERE id = ? AND version = ?',
            )
            .run(operation.title, draft.id, operation.expected_version);
          this.db
            .prepare(
              "UPDATE draft_updates SET status = 'completed', result_version = ? WHERE id = ?",
            )
            .run(draft.version + 1, operation.id);
          this.event(user, operation, 'update_completed', draft.id);
        }
      }
      const result = this.updateOperation(user, input.operationId);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  decideUpdate(user: User, id: string, decision: 'approve' | 'reject') {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const operation = this.updateOperation(user, id);
      if (
        decision === 'reject' &&
        (operation.status === 'approved' || operation.status === 'completed')
      )
        throw new AppError(409, 'An approved update cannot be rejected');
      if (operation.status === 'pending') {
        const status =
          decision === 'reject'
            ? 'rejected'
            : this.draft(user, operation.draft_id).version ===
                operation.expected_version
              ? 'approved'
              : 'conflict';
        this.db
          .prepare('UPDATE draft_updates SET status = ? WHERE id = ?')
          .run(status, id);
        this.event(user, operation, `update_${status}`, operation.draft_id);
      }
      const result = this.updateOperation(user, id);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  pendingUpdates(user: User) {
    return this.db
      .prepare(
        "SELECT u.* FROM draft_updates u JOIN memberships m ON u.project_id = m.project_id AND u.user_id = m.user_id WHERE u.user_id = ? AND u.status IN ('pending', 'approved')",
      )
      .all(user.id);
  }
  drafts(user: User) {
    return this.db
      .prepare(
        'SELECT d.* FROM drafts d JOIN memberships m ON m.project_id = d.project_id WHERE m.user_id = ?',
      )
      .all(user.id);
  }
  events(user: User) {
    return this.db
      .prepare(
        'SELECT id, operation_id, outcome, draft_id, created_at FROM events WHERE user_id = ? ORDER BY created_at, rowid',
      )
      .all(user.id);
  }
  recordCall(
    user: User,
    call: {
      id: string;
      operationId: string | null;
      method: string;
      path: string;
      status: number;
    },
  ) {
    this.db
      .prepare('INSERT OR IGNORE INTO calls VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        call.id,
        user.id,
        call.operationId,
        call.method,
        call.path,
        call.status,
        new Date().toISOString(),
      );
  }
  calls(user: User) {
    return this.db
      .prepare(
        'SELECT id, operation_id, method, path, status, created_at FROM calls WHERE user_id = ? ORDER BY created_at, rowid',
      )
      .all(user.id);
  }
  close() {
    this.db.close();
  }
}
