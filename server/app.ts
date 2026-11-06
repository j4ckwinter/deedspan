import express from 'express';
import { z } from 'zod';
import { agentReplySchema, agentRequestSchema } from '../src/core/types.js';

export interface ModelConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
}
export function createApiApp(
  config: ModelConfig,
  transport: typeof fetch = fetch,
) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    const host = req.headers.host ?? '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
      res.status(403).json({ error: 'Local access only' });
      return;
    }
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`) {
      res.status(403).json({ error: 'Cross-origin access denied' });
      return;
    }
    if (req.method === 'POST' && !req.is('application/json')) {
      res.status(415).json({ error: 'JSON body required' });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.get('/api/config', (_req, res) => {
    res.json({ model: config.model });
  });
  app.post('/api/agent/step', async (req, res) => {
    const parsed = agentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid agent request',
        details: parsed.error.issues.map((i) => i.message),
      });
      return;
    }
    try {
      const response = await transport(
        `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey
              ? { Authorization: `Bearer ${config.apiKey}` }
              : {}),
          },
          body: JSON.stringify({
            model: config.model,
            messages: parsed.data.messages,
            stream: false,
            tools: parsed.data.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
          }),
          signal: AbortSignal.timeout(60000),
        },
      );
      if (!response.ok) {
        res.status(502).json({
          error: `Model server returned HTTP ${response.status}. Check the server model configuration.`,
        });
        return;
      }
      const result = z
        .object({
          choices: z.array(z.object({ message: agentReplySchema })).min(1),
        })
        .parse(await response.json());
      res.json(result.choices[0]?.message);
    } catch {
      res.status(502).json({
        error:
          'Model server unavailable or returned an invalid response. Start a tool-capable model and check MODEL_BASE_URL and MODEL_NAME.',
      });
    }
  });
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown API route' });
  });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (!error) {
        next();
        return;
      }
      res.status(400).json({ error: 'Invalid or oversized JSON body' });
    },
  );
  return app;
}
