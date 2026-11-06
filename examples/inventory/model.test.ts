import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';

async function provider(listener: RequestListener) {
  const server = createServer(listener);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function run(endpoint: string) {
  const directory = mkdtempSync(join(tmpdir(), 'inventory-model-test-'));
  try {
    const result = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'model.ts'], {
        cwd: import.meta.dirname,
        env: {
          ...process.env,
          MODEL_NAME: 'controlled-test-provider',
          MODEL_BASE_URL: endpoint,
          INVENTORY_RUN_DIR: directory,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => child.kill(), 20000);
      child.stdout.setEncoding('utf8').on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.setEncoding('utf8').on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve({ code, stdout, stderr });
      });
    });
    if (!result.stdout.trim()) return { ...result, report: null };
    const summary = z
      .object({ reportPath: z.string() })
      .parse(JSON.parse(result.stdout));
    const report = z
      .object({
        status: z.enum(['passed', 'failed']),
        failure: z.string().nullable(),
        requests: z.array(z.string()),
        persisted: z.object({
          reservations: z.array(z.object({ quantity: z.number() })),
          products: z.array(
            z.object({ id: z.string(), available: z.number() }),
          ),
        }),
      })
      .parse(JSON.parse(readFileSync(summary.reportPath, 'utf8')));
    return { ...result, report };
  } finally {
    rmSync(directory, { recursive: true });
  }
}

function workflow(endless: boolean): RequestListener {
  let turn = 0;
  return async (request, response) => {
    try {
      let body = '';
      request.setEncoding('utf8');
      for await (const chunk of request) body += chunk;
      const payload = z
        .object({
          messages: z.array(
            z
              .object({
                role: z.string(),
                content: z.string().nullable().optional(),
              })
              .passthrough(),
          ),
          tools: z.array(
            z.object({ function: z.object({ name: z.string() }) }),
          ),
        })
        .parse(JSON.parse(body));
      assert.deepEqual(
        payload.tools.map((tool) => tool.function.name),
        ['search_available_products', 'reserve_inventory', 'get_reservation'],
      );
      const prompt = payload.messages.find(
        (message) => message.role === 'user',
      )?.content;
      const operationId = prompt?.match(/operationId ([0-9a-f-]{36})/)?.[1];
      assert.ok(operationId);
      let name: string;
      let args: unknown;
      if (turn === 0) {
        name = 'search_available_products';
        args = { query: 'notebook' };
      } else if (turn === 1) {
        name = 'reserve_inventory';
        args = { operationId, productId: 'notebook', quantity: 2 };
      } else {
        const toolResults = payload.messages.filter(
          (message) => message.role === 'tool',
        );
        const reservation = z
          .object({ output: z.object({ id: z.string() }) })
          .parse(JSON.parse(toolResults[1]?.content ?? 'null'));
        name = 'get_reservation';
        args = { reservationId: reservation.output.id };
      }
      const message =
        turn >= 3 && !endless
          ? { role: 'assistant', content: 'Reservation saved and retrieved.' }
          : {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: `provider-${turn}`,
                  type: 'function',
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            };
      turn += 1;
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ choices: [{ message }] }));
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  };
}

test('controlled provider completes discovery, reservation, retrieval and natural finish', async () => {
  const server = await provider(workflow(false));
  try {
    const result = await run(server.url);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.report?.status, 'passed');
    assert.equal(result.report.requests.length, 4);
    assert.deepEqual(result.report.persisted.reservations, [{ quantity: 2 }]);
    assert.equal(
      result.report.persisted.products.find(
        (product) => product.id === 'notebook',
      )?.available,
      3,
    );
  } finally {
    await server.close();
  }
});

test('turn limit fails even after saving and retrieving, retaining persisted state', async () => {
  const server = await provider(workflow(true));
  try {
    const result = await run(server.url);
    assert.equal(result.code, 1, result.stderr);
    assert.equal(result.report?.status, 'failed');
    assert.match(result.report.failure ?? '', /turn limit exceeded/);
    assert.equal(result.report.requests.length, 10);
    assert.deepEqual(result.report.persisted.reservations, [{ quantity: 2 }]);
    assert.equal(
      result.report.persisted.products.find(
        (product) => product.id === 'notebook',
      )?.available,
      3,
    );
  } finally {
    await server.close();
  }
});

test('redirects fail without contacting the redirect receiver', async () => {
  let received = 0;
  const receiver = await provider((_request, response) => {
    received += 1;
    response.end('{}');
  });
  const redirector = await provider((_request, response) => {
    response.writeHead(307, { Location: receiver.url }).end();
  });
  try {
    const result = await run(redirector.url);
    assert.equal(result.code, 1);
    assert.equal(result.report?.status, 'failed');
    assert.equal(received, 0);
    assert.deepEqual(result.report.persisted.reservations, []);
  } finally {
    await redirector.close();
    await receiver.close();
  }
});

test('endpoint credentials, query and fragment are rejected before requests', async () => {
  let received = 0;
  const server = await provider((_request, response) => {
    received += 1;
    response.end('{}');
  });
  try {
    for (const endpoint of [
      server.url.replace('http://', 'http://user:secret@'),
      `${server.url}?query=1`,
      `${server.url}#fragment`,
    ]) {
      const result = await run(endpoint);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /without credentials, query or fragment/);
      assert.equal(result.report, null);
    }
    assert.equal(received, 0);
  } finally {
    await server.close();
  }
});
