export {
  ToolRegistry,
  type ToolDefinition,
  type ToolExecutionContext,
  type RegistryOptions,
} from './registry.js';
export {
  connectWebMCP,
  createNativeToolClient,
  browserModelContext,
  type ModelContext,
  type WebMCPConnection,
} from './webmcp.js';
export type { ToolClient, ToolDescriptor, ToolTrace } from './types.js';

export { toolDescriptorSchema, toolTraceSchema } from './types.js';
