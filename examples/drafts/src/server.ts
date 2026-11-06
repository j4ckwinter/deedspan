import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createApp } from './app.js';
import { DraftStore } from './store.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.DRAFTS_PORT ?? 3101);
const password = process.env.DRAFTS_PASSWORD;
if (!password || password.length < 12)
  throw new Error(
    'Set DRAFTS_PASSWORD to at least 12 characters for the seeded demo accounts.',
  );
const path = process.env.DRAFTS_DB ?? resolve(root, '.data/drafts.sqlite');
mkdirSync(dirname(path), { recursive: true });
const store = new DraftStore(path);
store.seed(password);
const app = createApp(store, `http://127.0.0.1:${port}`);
const vite = await createServer({
  root,
  server: { middlewareMode: true },
  appType: 'spa',
});
app.use(vite.middlewares);
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Drafts example: http://127.0.0.1:${port}`);
});
async function close() {
  server.close();
  await vite.close();
  store.close();
}
process.once('SIGINT', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});
