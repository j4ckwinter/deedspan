import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { resolve } from 'node:path';
import { createApiApp } from './app.js';

const production = process.argv.includes('--production');
const app = createApiApp({
  baseUrl: process.env.MODEL_BASE_URL ?? 'http://127.0.0.1:11434/v1',
  model: process.env.MODEL_NAME ?? 'qwen3:8b',
  ...(process.env.MODEL_API_KEY ? { apiKey: process.env.MODEL_API_KEY } : {}),
});
const server = createHttpServer(app);
if (production) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => {
    res.sendFile(resolve('dist/index.html'));
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be between 1 and 65535');
server.listen(port, '127.0.0.1', () => {
  console.log(`Short Stack running at http://127.0.0.1:${port}`);
});
