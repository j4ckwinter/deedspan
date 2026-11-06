import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { ToolTrace } from 'deedspan';
import { Inventory, inventoryTools, reservationSchema } from './inventory.js';

const model = process.env.MODEL_NAME;
if (!model)
  throw new Error('Set MODEL_NAME to an installed tool-capable Ollama model');
const endpoint = new URL(
  process.env.MODEL_BASE_URL ?? 'http://127.0.0.1:11434/v1',
);
if (
  endpoint.protocol !== 'http:' ||
  endpoint.username !== '' ||
  endpoint.password !== '' ||
  endpoint.search !== '' ||
  endpoint.hash !== '' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
) {
  throw new Error(
    'This local example accepts loopback HTTP model endpoints without credentials, query or fragment only',
  );
}
const directory = resolve(
  process.env.INVENTORY_RUN_DIR ?? '.data',
  randomUUID(),
);
mkdirSync(directory, { recursive: true });
const path = resolve(directory, 'inventory.sqlite');
const password = randomUUID();
const application = new Inventory(path, password);
const session = application.login('buyer', password);
const operationId = randomUUID();
writeFileSync(
  resolve(directory, 'task.json'),
  JSON.stringify({ operationId, product: 'Recycled notebook', quantity: 2 }),
);
const prompt = `Find available recycled notebooks, reserve exactly 2, then retrieve the saved reservation. Use operationId ${operationId} for every reservation attempt. Discover product IDs through search. Report the saved reservation ID.`;
const messages: unknown[] = [
  {
    role: 'system',
    content:
      'Use the provided application tools to complete the task. A failed tool result is not a successful action. Never invent a saved result.',
  },
  { role: 'user', content: prompt },
];
const traces: ToolTrace[] = [];
const responses: unknown[] = [];
const requests: string[] = [];
const deadline = AbortSignal.timeout(300000);
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            role: z.literal('assistant'),
            content: z.string().nullable().optional(),
            tool_calls: z
              .array(
                z.object({
                  id: z.string(),
                  type: z.literal('function'),
                  function: z.object({
                    name: z.string(),
                    arguments: z.string(),
                  }),
                }),
              )
              .optional(),
          })
          .passthrough(),
      }),
    )
    .min(1),
});
let discovered = false;
let savedId: string | undefined;
let retrieved = false;
let finished = false;
let failure: string | null = null;
let persisted: unknown;
const tools = inventoryTools(application, session, {}, (request) => {
  assert.ok(discovered, 'Model must discover the notebook before reservation');
  assert.equal(
    request.operationId,
    operationId,
    'Task operation ID must be preserved',
  );
  assert.equal(
    request.productId,
    'notebook',
    'Task only permits the discovered notebook',
  );
  assert.equal(request.quantity, 2, 'Task only permits two notebooks');
});
try {
  for (let turn = 0; turn < 10; turn += 1) {
    const requestBody = JSON.stringify({
      model,
      temperature: 0,
      messages,
      tools: tools.list().map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })),
    });
    requests.push(requestBody);
    const response = await fetch(
      `${endpoint.href.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.any([deadline, AbortSignal.timeout(120000)]),
        body: requestBody,
      },
    );
    if (!response.ok)
      throw new Error(
        `Model HTTP ${response.status}: ${await response.text()}`,
      );
    const raw: unknown = await response.json();
    responses.push(raw);
    const parsed = responseSchema.parse(raw);
    const choice = parsed.choices[0];
    assert.ok(choice);
    messages.push(choice.message);
    if (!choice.message.tool_calls?.length) {
      finished = true;
      break;
    }
    for (const call of choice.message.tool_calls) {
      if (traces.length >= 20) throw new Error('Tool call limit exceeded');
      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        args = call.function.arguments;
      }
      const trace = await tools.call(call.function.name, args);
      traces.push(trace);
      if (
        trace.status === 'success' &&
        trace.name === 'search_available_products'
      ) {
        discovered = z
          .array(z.object({ id: z.string() }))
          .parse(trace.output)
          .some((product) => product.id === 'notebook');
      }
      if (trace.status === 'success' && trace.name === 'reserve_inventory')
        savedId = reservationSchema.parse(trace.output).id;
      if (trace.status === 'success' && trace.name === 'get_reservation')
        retrieved = reservationSchema.parse(trace.output).id === savedId;
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({
          status: trace.status,
          output: trace.output,
          callId: trace.id,
        }),
      });
    }
  }
  assert.ok(finished, 'Model turn limit exceeded before a natural finish');
  assert.ok(
    discovered,
    'A successful search containing the notebook is required',
  );
  assert.ok(savedId, 'A successful reservation is required');
  assert.ok(retrieved, 'The model must retrieve the saved reservation');
  const db = new DatabaseSync(path);
  try {
    const reservations = db.prepare('SELECT * FROM reservations').all();
    const products = db.prepare('SELECT * FROM products ORDER BY id').all();
    const audit = db.prepare('SELECT * FROM audit').all();
    persisted = { reservations, products, audit };
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0]?.id, savedId);
    assert.equal(reservations[0]?.quantity, 2);
    assert.equal(reservations[0]?.operation_id, operationId);
    assert.equal(
      products.find((product) => product.id === 'notebook')?.available,
      3,
    );
    assert.equal(
      products.find((product) => product.id === 'pencil')?.available,
      20,
    );
  } finally {
    db.close();
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  application.close();
  if (!persisted) {
    const db = new DatabaseSync(path);
    try {
      persisted = {
        reservations: db.prepare('SELECT * FROM reservations').all(),
        products: db.prepare('SELECT * FROM products').all(),
        audit: db.prepare('SELECT * FROM audit').all(),
      };
    } finally {
      db.close();
    }
  }
  const report = {
    status: failure ? 'failed' : 'passed',
    model,
    endpoint: endpoint.href,
    operationId,
    prompt,
    tools: tools.list(),
    requests,
    responses,
    traces,
    persisted,
    failure,
  };
  const reportPath = resolve(directory, 'report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ status: report.status, reportPath, failure })}\n`,
  );
}
