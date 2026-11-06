import { z } from 'zod';
import {
  toolDescriptorSchema,
  type ToolDescriptor,
  type ToolTrace,
} from '../core/types.js';

export interface ToolDefinition<T> {
  name: string;
  description: string;
  input: z.ZodType<T>;
  execute: (input: T) => unknown | Promise<unknown>;
  authorize?: () => boolean | Promise<boolean>;
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
  execute: (input: unknown) => unknown | Promise<unknown>,
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
    trace.output = snapshotValue(await execute(snapshotValue(trace.input)));
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
  run: (input: unknown) => Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly listeners = new Set<() => void>();

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
      run: async (input) => {
        if (definition.authorize && !(await definition.authorize())) {
          throw new Error('Permission denied');
        }
        const parsed = await definition.input.parseAsync(input);
        return definition.execute(parsed);
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
    return captureCall(name, input, async (snapshot) => {
      const tool = this.tools.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return tool.run(snapshot);
    });
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
