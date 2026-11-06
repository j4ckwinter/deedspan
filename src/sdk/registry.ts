import { z } from 'zod';
import {
  toolDescriptorSchema,
  type ToolDescriptor,
  type ToolTrace,
} from './types.js';

export interface ToolExecutionContext {
  readonly callId: string;
}

export interface RegistryOptions {
  onTrace?: (trace: ToolTrace) => void | Promise<void>;
  capture?: 'metadata' | 'full';
}

export interface ToolDefinition<T> {
  name: string;
  description: string;
  input: z.ZodType<T>;
  execute: (
    input: T,
    context: ToolExecutionContext,
  ) => unknown | Promise<unknown>;
  authorize?: (
    input: T,
    context: ToolExecutionContext,
  ) => boolean | Promise<boolean>;
}

export function snapshotValue(value: unknown): unknown {
  if (value === undefined) return null;
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (
      typeof item === 'bigint' ||
      typeof item === 'function' ||
      typeof item === 'symbol'
    ) {
      throw new Error('Tool inputs and results must be JSON serializable');
    }
    if (typeof item === 'number' && !Number.isFinite(item)) {
      throw new Error('Tool inputs and results must contain finite numbers');
    }
    return item;
  });
  return JSON.parse(json) as unknown;
}

export async function captureCall(
  name: string,
  input: unknown,
  execute: (
    input: unknown,
    context: ToolExecutionContext,
  ) => unknown | Promise<unknown>,
): Promise<ToolTrace> {
  const started = performance.now();
  const trace: ToolTrace = {
    id: crypto.randomUUID(),
    name,
    input: null,
    output: null,
    status: 'error',
    durationMs: 0,
  };
  try {
    trace.input = snapshotValue(input);
    trace.output = snapshotValue(
      await execute(
        snapshotValue(trace.input),
        Object.freeze({ callId: trace.id }),
      ),
    );
    trace.status = 'success';
  } catch (error) {
    trace.output = {
      error: error instanceof Error ? error.message : 'Tool execution failed',
    };
  }
  trace.durationMs = Math.round((performance.now() - started) * 100) / 100;
  return trace;
}

interface RegisteredTool {
  descriptor: ToolDescriptor;
  run: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: RegistryOptions = {}) {}

  register<T>(definition: ToolDefinition<T>): () => void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool already registered: ${definition.name}`);
    }
    const descriptor = toolDescriptorSchema.parse({
      name: definition.name,
      description: definition.description,
      inputSchema: z.toJSONSchema(definition.input),
    });
    if (descriptor.inputSchema.type !== 'object') {
      throw new Error('Tool input schemas must describe an object');
    }
    const tool: RegisteredTool = {
      descriptor,
      run: async (input, context) => {
        const parsed = await definition.input.parseAsync(input);
        if (
          definition.authorize &&
          !(await definition.authorize(parsed, context))
        ) {
          throw new Error('Permission denied');
        }
        return definition.execute(parsed, context);
      },
    };
    this.tools.set(definition.name, tool);
    this.notify();
    return () => {
      if (this.tools.get(definition.name) !== tool) return;
      this.tools.delete(definition.name);
      this.notify();
    };
  }

  list(): ToolDescriptor[] {
    return structuredClone(
      [...this.tools.values()].map((tool) => tool.descriptor),
    );
  }

  async call(name: string, input: unknown): Promise<ToolTrace> {
    const trace = await captureCall(name, input, async (snapshot, context) => {
      const tool = this.tools.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return tool.run(snapshot, context);
    });
    if (this.options.onTrace) {
      const observed =
        this.options.capture === 'full'
          ? structuredClone(trace)
          : { ...trace, input: null, output: null };
      try {
        await this.options.onTrace(observed);
      } catch {
        // Telemetry failure must not turn a completed mutation into a retry.
      }
    }
    return trace;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
