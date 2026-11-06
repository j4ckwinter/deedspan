import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { ToolRegistry } from '../src/sdk/registry.js';
import {
  connectWebMCP,
  createNativeToolClient,
  type ModelContext,
  type NativeTool,
} from '../src/sdk/webmcp.js';

function registryWithEcho() {
  const registry = new ToolRegistry();
  registry.register({
    name: 'echo',
    description: 'Return a message',
    input: z.strictObject({ message: z.string() }),
    execute: (input) => input,
  });
  return registry;
}

test('validates inputs before calling application code and describes schemas', async () => {
  const registry = registryWithEcho();
  const invalid = await registry.call('echo', { message: 42 });
  assert.equal(invalid.status, 'error');
  const valid = await registry.call('echo', { message: 'hello' });
  assert.equal(valid.status, 'success');
  assert.deepEqual(valid.output, { message: 'hello' });
  assert.equal(registry.list()[0]?.inputSchema.type, 'object');
  assert.equal((await registry.call('missing', {})).status, 'error');
});

test('checks current authorization for every call', async () => {
  const registry = new ToolRegistry();
  let allowed = false;
  let executions = 0;
  registry.register({
    name: 'write',
    description: 'Write a draft',
    input: z.object({}),
    authorize: () => allowed,
    execute: () => {
      executions++;
      return {};
    },
  });
  assert.deepEqual((await registry.call('write', {})).output, {
    error: 'Permission denied',
  });
  allowed = true;
  assert.equal((await registry.call('write', {})).status, 'success');
  allowed = false;
  assert.equal((await registry.call('write', {})).status, 'error');
  assert.equal(executions, 1);
});

test('rejects duplicate names and stale cleanup cannot unregister a replacement', () => {
  const registry = new ToolRegistry();
  const definition = {
    name: 'one',
    description: 'First',
    input: z.object({}),
    execute: () => ({}),
  };
  const cleanup = registry.register(definition);
  assert.throws(() => registry.register(definition), /already registered/);
  cleanup();
  registry.register(definition);
  cleanup();
  assert.equal(registry.list().length, 1);
  assert.throws(
    () =>
      registry.register({ ...definition, name: 'scalar', input: z.string() }),
    /must describe an object/,
  );
});

test('trace inputs and outputs are snapshots and descriptors cannot mutate registration', async () => {
  const registry = new ToolRegistry();
  const output = { title: 'original' };
  registry.register({
    name: 'snapshot',
    description: 'Snapshot',
    input: z.object({ title: z.string() }),
    execute: () => output,
  });
  const input = { title: 'before' };
  const trace = await registry.call('snapshot', input);
  input.title = 'after';
  output.title = 'changed';
  assert.deepEqual(trace.input, { title: 'before' });
  assert.deepEqual(trace.output, { title: 'original' });
  const descriptors = registry.list();
  const first = descriptors[0];
  assert(first);
  first.name = 'corrupted';
  assert.equal(registry.list()[0]?.name, 'snapshot');
});

test('unsupported trace values fail before effects and execution errors are captured', async () => {
  const registry = new ToolRegistry();
  let executions = 0;
  registry.register({
    name: 'error',
    description: 'Failure',
    input: z.object({}),
    execute: () => {
      executions++;
      throw new Error('Application rejected operation');
    },
  });
  assert.equal(
    (await registry.call('error', { invalid: BigInt(1) })).status,
    'error',
  );
  assert.equal(executions, 0);
  assert.deepEqual((await registry.call('error', {})).output, {
    error: 'Application rejected operation',
  });
});

test('native registrations use signal cleanup and preserve unrelated tools', async () => {
  const registry = registryWithEcho();
  const registrations = new Map<string, NativeTool>();
  const context: ModelContext = {
    async registerTool(tool, options) {
      registrations.set(tool.name, tool);
      options?.signal.addEventListener('abort', () =>
        registrations.delete(tool.name),
      );
    },
  };
  const unrelated = {
    ...registry.list()[0]!,
    name: 'unrelated',
    execute: async () => null,
  };
  registrations.set('unrelated', unrelated);
  const connection = await connectWebMCP(registry, context);
  assert.match(connection.status, /Connected: 1/);
  assert.deepEqual(
    await registrations.get('echo')?.execute({ message: 'native' }),
    { message: 'native' },
  );
  await assert.rejects(() =>
    registrations.get('echo')!.execute({ message: 1 }),
  );
  connection.dispose();
  connection.dispose();
  assert.deepEqual([...registrations.keys()], ['unrelated']);
});

test('failed native registration rolls back only registrations owned by the connection', async () => {
  const registry = registryWithEcho();
  registry.register({
    name: 'duplicate',
    description: 'Exists natively',
    input: z.object({}),
    execute: () => null,
  });
  const removed: string[] = [];
  const context: ModelContext = {
    registerTool(tool, options) {
      if (tool.name === 'duplicate') throw new Error('Native duplicate');
      options?.signal.addEventListener('abort', () => removed.push(tool.name));
    },
  };
  const connection = await connectWebMCP(registry, context);
  assert.match(connection.status, /registration failed/);
  assert.deepEqual(removed, ['echo']);
  connection.dispose();
  assert.deepEqual(removed, ['echo']);
});

test('native connection follows registry lifecycle changes', async () => {
  const registry = new ToolRegistry();
  const registrations = new Set<string>();
  const context: ModelContext = {
    registerTool(tool, options) {
      registrations.add(tool.name);
      options?.signal.addEventListener('abort', () =>
        registrations.delete(tool.name),
      );
    },
  };
  const connection = await connectWebMCP(registry, context);
  const unregister = registry.register({
    name: 'late',
    description: 'Late',
    input: z.object({}),
    execute: () => null,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(registrations.has('late'));
  unregister();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(!registrations.has('late'));
  connection.dispose();
});

test('native discovery includes existing same-origin registrations without taking ownership', async () => {
  const descriptor = registryWithEcho().list()[0]!;
  const sameOrigin = { ...descriptor, origin: 'https://app.example' };
  const otherOrigin = {
    ...descriptor,
    name: 'foreign',
    origin: 'https://other.example',
  };
  const context: ModelContext = {
    registerTool() {
      throw new Error('Should not register existing tools');
    },
    getTools: async () => [sameOrigin, otherOrigin],
    executeTool: async (tool, input) => {
      assert.equal(tool, sameOrigin);
      return input;
    },
  };
  const client = createNativeToolClient(context, 'https://app.example');
  assert.deepEqual(
    (await client.list()).map((tool) => tool.name),
    ['echo'],
  );
  assert.equal((await client.call('foreign', {})).status, 'error');
  assert.deepEqual((await client.call('echo', { message: 'ok' })).output, {
    message: 'ok',
  });
});

test('a caller cannot change execution arguments while authorization is pending', async () => {
  const registry = new ToolRegistry();
  let allow: (value: boolean) => void = () => {};
  const authorization = new Promise<boolean>((resolve) => {
    allow = resolve;
  });
  registry.register({
    name: 'delayed',
    description: 'Delayed',
    input: z.object({ value: z.string() }),
    authorize: () => authorization,
    execute: (input) => input,
  });
  const input = { value: 'before' };
  const call = registry.call('delayed', input);
  input.value = 'after';
  allow(true);
  const trace = await call;
  assert.deepEqual(trace.input, { value: 'before' });
  assert.deepEqual(trace.output, { value: 'before' });
});

test('native cleanup selects explicit unregister when both mechanisms exist', async () => {
  const registry = registryWithEcho();
  const removed: string[] = [];
  let aborts = 0;
  const connection = await connectWebMCP(registry, {
    registerTool(_tool, options) {
      options?.signal.addEventListener('abort', () => aborts++);
    },
    unregisterTool(name) {
      removed.push(name);
    },
  });
  connection.dispose();
  connection.dispose();
  assert.deepEqual(removed, ['echo']);
  assert.equal(aborts, 0);
  assert.equal(connection.status, 'Disconnected');
});

test('native cleanup attempts every tool and retains failures for retry', async () => {
  const registry = registryWithEcho();
  registry.register({
    name: 'second',
    description: 'Second tool',
    input: z.object({}),
    execute: () => null,
  });
  const registrations = new Set<string>();
  const attempts: string[] = [];
  let fail = true;
  const connection = await connectWebMCP(registry, {
    registerTool(tool) {
      registrations.add(tool.name);
    },
    unregisterTool(name) {
      attempts.push(name);
      if (name === 'echo' && fail) throw new Error('Temporarily unavailable');
      registrations.delete(name);
    },
  });
  assert.doesNotThrow(() => connection.dispose());
  assert.deepEqual(attempts, ['echo', 'second']);
  assert.deepEqual([...registrations], ['echo']);
  assert.match(
    connection.status,
    /cleanup failed: echo: Temporarily unavailable/,
  );
  fail = false;
  connection.dispose();
  assert.deepEqual(attempts, ['echo', 'second', 'echo']);
  assert.equal(registrations.size, 0);
  assert.equal(connection.status, 'Disconnected');
});

test('native synchronization recovers after a cleanup failure', async () => {
  const registry = new ToolRegistry();
  const definition = {
    name: 'first',
    description: 'First tool',
    input: z.object({}),
    execute: () => null,
  };
  const unregister = registry.register(definition);
  const registrations = new Set<string>();
  let fail = true;
  const connection = await connectWebMCP(registry, {
    registerTool(tool) {
      registrations.add(tool.name);
    },
    unregisterTool(name) {
      if (fail) throw new Error('Temporarily unavailable');
      registrations.delete(name);
    },
  });
  unregister();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(connection.status, /cleanup failed/);
  assert.deepEqual([...registrations], ['first']);
  fail = false;
  registry.register({ ...definition, name: 'second' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual([...registrations], ['second']);
  assert.match(connection.status, /Connected: 1/);
  connection.dispose();
});

test('call context links authorization and execution to a metadata-only observer', async () => {
  const observed: import('../src/sdk/types.js').ToolTrace[] = [];
  let executionId = '';
  const registry = new ToolRegistry({
    onTrace: (trace) => {
      observed.push(trace);
    },
  });
  registry.register({
    name: 'private_echo',
    description: 'Echo sensitive data',
    input: z.object({ secret: z.string() }),
    authorize: (input, context) => {
      executionId = context.callId;
      return input.secret === 'private';
    },
    execute: (input, context) => {
      assert.equal(context.callId, executionId);
      assert(Object.isFrozen(context));
      return input;
    },
  });
  const result = await registry.call('private_echo', { secret: 'private' });
  assert.equal(result.id, executionId);
  assert.deepEqual(result.output, { secret: 'private' });
  assert.deepEqual(observed, [{ ...result, input: null, output: null }]);
  const denied = await registry.call('private_echo', { secret: 'different' });
  assert.equal(denied.status, 'error');
  assert.equal(observed[1]?.output, null);
});

test('full trace observers cannot mutate results or turn completed writes into failures', async () => {
  let executions = 0;
  const registry = new ToolRegistry({
    capture: 'full',
    onTrace: async (trace) => {
      assert.deepEqual(trace.output, { saved: true });
      trace.output = { saved: false };
      throw new Error('Telemetry unavailable');
    },
  });
  registry.register({
    name: 'write',
    description: 'Write once',
    input: z.object({}),
    execute: () => {
      executions++;
      return { saved: true };
    },
  });
  const result = await registry.call('write', {});
  assert.equal(result.status, 'success');
  assert.deepEqual(result.output, { saved: true });
  assert.equal(executions, 1);
});
