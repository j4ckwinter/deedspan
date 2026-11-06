import { z } from 'zod';
import { agentReplySchema, type AgentStep } from './types.js';

export const scriptedStep: AgentStep = async ({ messages }) => {
  const prompt = messages.find((m) => m.role === 'user')?.content ?? '';
  const match =
    /^Create (.+?) in the (Marketing|Engineering) project\.?$/i.exec(
      prompt.trim(),
    );
  if (!match?.[1] || !match[2])
    throw new Error(
      'Scripted demo accepts: Create [title] in the [Marketing or Engineering] project. Use model mode for other prompts.',
    );
  const replies = messages.filter((m) => m.role === 'tool');
  const call = (name: string, input: unknown) => ({
    content: null,
    tool_calls: [
      {
        id: crypto.randomUUID(),
        type: 'function' as const,
        function: { name, arguments: JSON.stringify(input) },
      },
    ],
  });
  if (replies.length === 0) return call('find_project', { name: match[2] });
  const previous: unknown = JSON.parse(replies.at(-1)?.content ?? '{}');
  if (typeof previous === 'object' && previous !== null && 'error' in previous)
    return { content: `Tool failed: ${String(previous.error)}` };
  const { id } = z.object({ id: z.string() }).parse(previous);
  if (replies.length === 1)
    return call('create_draft', { projectId: id, title: match[1] });
  if (replies.length === 2) return call('get_draft', { id });
  return { content: 'The draft was created and retrieved.' };
};

export const modelStep: AgentStep = async (request, signal) => {
  const response = await fetch('/api/agent/step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: signal ?? null,
  });
  if (!response.ok) {
    const error: unknown = await response.json();
    const parsed = z.object({ error: z.string() }).safeParse(error);
    throw new Error(
      parsed.success ? parsed.data.error : 'Model request failed',
    );
  }
  return agentReplySchema.parse(await response.json());
};
