import { randomBytes } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { createDraftSchema, updateDraftSchema } from './contracts.js';
import { AppError, DraftStore, type User } from './store.js';

interface Session {
  user: User;
  csrf: string;
  expires: number;
}
export function createApp(store: DraftStore, origin: string) {
  const app = express();
  const sessions = new Map<string, Session>();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers.host !== new URL(origin).host) {
      res.status(403).json({ error: 'Unexpected host' });
      return;
    }
    if (
      req.method !== 'GET' &&
      (req.headers.origin !== origin || !req.is('application/json'))
    ) {
      res.status(403).json({ error: 'Same-origin JSON requests required' });
      return;
    }
    const id = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('draft_session='))
      ?.slice('draft_session='.length);
    const session = id ? sessions.get(id) : undefined;
    if (session && session.expires > Date.now()) res.locals.session = session;
    else if (id) sessions.delete(id);
    next();
  });
  app.post('/api/login', (req, res) => {
    const body = z
      .object({ username: z.string().max(100), password: z.string().max(200) })
      .safeParse(req.body);
    const user = body.success
      ? store.login(body.data.username, body.data.password)
      : undefined;
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    for (const [key, value] of sessions)
      if (value.expires <= Date.now()) sessions.delete(key);
    const id = randomBytes(32).toString('hex');
    const session = {
      user,
      csrf: randomBytes(32).toString('hex'),
      expires: Date.now() + 60 * 60 * 1000,
    };
    sessions.set(id, session);
    res.cookie('draft_session', id, {
      httpOnly: true,
      sameSite: 'strict',
      secure: origin.startsWith('https:'),
      maxAge: 60 * 60 * 1000,
    });
    res.json({ user, csrf: session.csrf });
  });
  app.use('/api', (req, res, next) => {
    const session = res.locals.session as Session | undefined;
    if (!session) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }
    if (req.method !== 'GET' && req.headers['x-csrf-token'] !== session.csrf) {
      res.status(403).json({ error: 'Invalid CSRF token' });
      return;
    }
    const callId = req.headers['x-tool-call-id'];
    if (typeof callId === 'string' && z.uuid().safeParse(callId).success) {
      const operationId = z
        .object({ operationId: z.uuid() })
        .safeParse(req.body);
      res.on('finish', () =>
        store.recordCall(session.user, {
          id: callId,
          operationId: operationId.success
            ? operationId.data.operationId
            : null,
          method: req.method,
          path: req.path,
          status: res.statusCode,
        }),
      );
    }
    next();
  });
  const user = (res: express.Response) => (res.locals.session as Session).user;
  app.post('/api/logout', (_req, res) => {
    const session = res.locals.session as Session;
    for (const [id, candidate] of sessions)
      if (candidate === session) sessions.delete(id);
    res.clearCookie('draft_session');
    res.json({ signedOut: true });
  });
  app.get('/api/session', (_req, res) => {
    const session = res.locals.session as Session;
    res.json({ user: session.user, csrf: session.csrf });
  });
  app.get('/api/projects', (_req, res) => {
    res.json(store.projects(user(res)));
  });
  app.get('/api/drafts', (_req, res) => {
    res.json(store.drafts(user(res)));
  });
  app.get('/api/drafts/:id', (req, res) => {
    res.json(store.draft(user(res), String(req.params.id)));
  });
  app.get('/api/approvals', (_req, res) => {
    res.json(store.pending(user(res)));
  });
  app.get('/api/draft-updates/approvals', (_req, res) => {
    res.json(store.pendingUpdates(user(res)));
  });
  app.post('/api/draft-updates', (req, res) => {
    const parsed = updateDraftSchema.safeParse(req.body);
    if (!parsed.success)
      throw new AppError(400, 'Invalid draft update request');
    const operation = store.update(user(res), parsed.data);
    res.json({
      operationId: operation.id,
      status:
        operation.status === 'pending' || operation.status === 'approved'
          ? 'confirmation_required'
          : operation.status,
      draftId: operation.draft_id,
      version: operation.result_version,
    });
  });
  app.post('/api/draft-updates/:id/approve', (req, res) => {
    res.json(store.decideUpdate(user(res), String(req.params.id), 'approve'));
  });
  app.post('/api/draft-updates/:id/reject', (req, res) => {
    res.json(store.decideUpdate(user(res), String(req.params.id), 'reject'));
  });
  app.get('/api/calls', (_req, res) => {
    res.json(store.calls(user(res)));
  });
  app.get('/api/events', (_req, res) => {
    res.json(store.events(user(res)));
  });
  app.post('/api/drafts', (req, res) => {
    const parsed = createDraftSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Invalid draft request');
    const operation = store.create(user(res), parsed.data);
    res.json({
      operationId: operation.id,
      status:
        operation.status === 'completed'
          ? 'completed'
          : 'confirmation_required',
      draftId: operation.draft_id,
    });
  });
  app.post('/api/approvals/:id', (req, res) => {
    res.json(store.approve(user(res), String(req.params.id)));
  });
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown API route' });
  });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        _next(error);
        return;
      }
      res.status(error instanceof AppError ? error.status : 500).json({
        error: error instanceof AppError ? error.message : 'Request failed',
      });
    },
  );
  return app;
}
