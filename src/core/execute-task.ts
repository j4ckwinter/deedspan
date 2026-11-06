import type { ToolClient, ToolTrace, ToolDescriptor } from 'short-stack';
import type { AgentMessage, AgentStep } from './types.js';

export async function executeTask(options: {
  prompt: string;
  instructions: string;
  tools: ToolClient;
  step: AgentStep;
  signal?: AbortSignal;
  onTrace: (trace: ToolTrace) => void;
  onDiscovery?: (tools: ToolDescriptor[]) => void;
}): Promise<string> {
  const { tools, step, signal, onTrace } = options;
  signal?.throwIfAborted();
  const descriptors = await tools.list();
  options.onDiscovery?.(structuredClone(descriptors));
  const messages: AgentMessage[] = [
    { role: 'system', content: options.instructions },
    { role: 'user', content: options.prompt },
  ];
  let callCount = 0;
  for (let turn = 0; turn < 8; turn++) {
    signal?.throwIfAborted();
    const reply = await step(
      {
        messages: structuredClone(messages),
        tools: structuredClone(descriptors),
      },
      signal,
    );
    signal?.throwIfAborted();
    messages.push({ role: 'assistant', ...reply });
    const calls = reply.tool_calls ?? [];
    if (calls.length === 0) return reply.content ?? '';
    for (const call of calls) {
      signal?.throwIfAborted();
      if (callCount >= 20) throw new Error('Tool call limit reached');
      let input: unknown;
      try {
        input = JSON.parse(call.function.arguments);
      } catch {
        throw new Error(`Invalid JSON arguments for ${call.function.name}`);
      }
      const trace = await tools.call(call.function.name, input);
      callCount++;
      onTrace(trace);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(trace.output),
      });
    }
  }
  throw new Error('Agent turn limit reached');
}
