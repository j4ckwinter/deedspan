import { useEffect } from 'react';
import type { ToolDefinition, ToolRegistry } from './registry.js';

export function useRegisteredTool<T>(
  registry: ToolRegistry,
  definition: ToolDefinition<T>,
): void {
  useEffect(() => registry.register(definition), [registry, definition]);
}
