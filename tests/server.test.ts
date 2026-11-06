import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApiApp } from '../server/app.js';

const config = {
  baseUrl: 'http://model.test/v1',
  model: 'test-model',
  apiKey: 'test-secret',
};
const input = {
  messages: [{ role: 'user', content: 'Create notes' }],
  tools: [
    {
      name: 'create_draft',
      description: 'Create a draft',
      inputSchema: { type: 'object' },
    },
  ],
};
async function withApp(
  transport: typeof fetch,
  check: (url: string) => Promise<void>,
) {
  const server = createApiApp(config, transport).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    await check(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
test('model proxy maps schemas and preserves tool calls while keeping key server-side', async () => {
  await withApp(
    async (url, init) => {
      assert.equal(url, 'http://model.test/v1/chat/completions');
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        'Bearer test-secret',
      );
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.model, 'test-model');
      assert.equal(payload.tools[0].function.name, 'create_draft');
      return Response.json({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: '1',
                  type: 'function',
                  function: { name: 'create_draft', arguments: '{}' },
                },
              ],
            },
          },
        ],
      });
    },
    async (url) => {
      const publicConfig = await (await fetch(`${url}/api/config`)).text();
      assert(!publicConfig.includes('test-secret'));
      const response = await fetch(`${url}/api/agent/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).tool_calls[0].id, '1');
    },
  );
});
test('invalid input and cross-origin requests never reach the model', async () => {
  await withApp(
    async () => {
      throw new Error('must not be called');
    },
    async (url) => {
      assert.equal(
        (
          await fetch(`${url}/api/agent/step`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await fetch(`${url}/api/agent/step`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://evil.example',
            },
            body: JSON.stringify(input),
          })
        ).status,
        403,
      );
      assert.equal(
        (await fetch(`${url}/api/agent/step`, { method: 'POST', body: '{}' }))
          .status,
        415,
      );
    },
  );
});
test('malformed model replies produce actionable errors without provider data', async () => {
  await withApp(
    async () => Response.json({ secret: 'test-secret' }),
    async (url) => {
      const response = await fetch(`${url}/api/agent/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      assert.equal(response.status, 502);
      const body = await response.text();
      assert(!body.includes('test-secret'));
      assert(body.includes('MODEL_BASE_URL'));
    },
  );
});
