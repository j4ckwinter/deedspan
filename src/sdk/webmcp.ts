import {
  toolDescriptorSchema,
  type ToolDescriptor,
  type ToolTrace,
} from '../core/types.js';
import { captureCall, ToolRegistry } from './registry.js';

export interface NativeTool extends ToolDescriptor {
  execute: (input: unknown) => Promise<unknown>;
}

export interface NativeRegisteredTool extends ToolDescriptor {
  origin: string;
}

export interface ModelContext {
  registerTool: (
    tool: NativeTool,
    options?: { signal: AbortSignal },
  ) => void | Promise<void>;
  unregisterTool?: (name: string) => void;
  getTools?: () => Promise<NativeRegisteredTool[]>;
  executeTool?: (
    tool: NativeRegisteredTool,
    input: unknown,
  ) => Promise<unknown>;
}

export interface WebMCPConnection {
  readonly status: string;
  dispose: () => void;
}

function contextFrom(container: unknown): ModelContext | undefined {
  if (
    !container ||
    typeof container !== 'object' ||
    !('modelContext' in container)
  )
    return undefined;
  const candidate = container.modelContext;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    !('registerTool' in candidate) ||
    typeof candidate.registerTool !== 'function'
  )
    return undefined;
  return candidate as ModelContext;
}

export function browserModelContext(): ModelContext | undefined {
  return contextFrom(globalThis.document) ?? contextFrom(globalThis.navigator);
}

export async function connectWebMCP(
  registry: ToolRegistry,
  context: ModelContext | undefined = browserModelContext(),
): Promise<WebMCPConnection> {
  if (!context)
    return {
      status: 'Unavailable in this browser; local SDK tools remain usable',
      dispose: () => {},
    };
  let status = 'Connecting';
  let disposed = false;
  const owned = new Map<
    string,
    { controller: AbortController; descriptor: string }
  >();
  const remove = (name: string) => {
    const registration = owned.get(name);
    if (!registration) return;
    owned.delete(name);
    registration.controller.abort();
    context.unregisterTool?.(name);
  };
  const synchronize = async () => {
    if (disposed) return;
    const descriptors = registry.list();
    for (const [name, registration] of owned) {
      const descriptor = descriptors.find((tool) => tool.name === name);
      if (!descriptor || JSON.stringify(descriptor) !== registration.descriptor)
        remove(name);
    }
    try {
      for (const descriptor of descriptors) {
        if (disposed) break;
        if (owned.has(descriptor.name)) continue;
        const controller = new AbortController();
        await context.registerTool(
          {
            ...descriptor,
            execute: async (input) => {
              const trace = await registry.call(descriptor.name, input);
              if (trace.status === 'error') {
                const output = trace.output;
                const message =
                  output && typeof output === 'object' && 'error' in output
                    ? String(output.error)
                    : 'Tool execution failed';
                throw new Error(message);
              }
              return trace.output;
            },
          },
          { signal: controller.signal },
        );
        owned.set(descriptor.name, {
          controller,
          descriptor: JSON.stringify(descriptor),
        });
        if (disposed) remove(descriptor.name);
      }
      if (!disposed) status = `Connected: ${owned.size} WebMCP tools`;
    } catch (error) {
      status = `WebMCP registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      for (const name of owned.keys()) remove(name);
    }
  };
  let pending = Promise.resolve();
  const queue = () => {
    pending = pending.then(synchronize);
  };
  const unsubscribe = registry.subscribe(queue);
  queue();
  await pending;
  return {
    get status() {
      return status;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      for (const name of owned.keys()) remove(name);
      status = 'Disconnected';
    },
  };
}

export function createNativeToolClient(context: ModelContext, origin: string) {
  if (!context.getTools || !context.executeTool) {
    throw new Error(
      'This browser does not support native WebMCP discovery and execution',
    );
  }
  const getTools = context.getTools.bind(context);
  const executeTool = context.executeTool.bind(context);
  const discover = async () =>
    (await getTools()).filter((tool) => tool.origin === origin);
  return {
    async list(): Promise<ToolDescriptor[]> {
      return (await discover()).map((tool) => toolDescriptorSchema.parse(tool));
    },
    async call(name: string, input: unknown): Promise<ToolTrace> {
      return captureCall(name, input, async (snapshot) => {
        const matches = (await discover()).filter((tool) => tool.name === name);
        if (matches.length !== 1 || !matches[0]) {
          throw new Error(
            matches.length
              ? `Ambiguous tool: ${name}`
              : `Unknown same-origin tool: ${name}`,
          );
        }
        return executeTool(matches[0], snapshot);
      });
    },
  };
}
