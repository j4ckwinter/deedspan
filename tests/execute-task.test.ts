import assert from 'node:assert/strict';
import test from 'node:test';
import { executeTask } from '../src/core/execute-task.js';
import type { ToolClient, ToolTrace } from '../src/sdk/types.js';

test('agent execution works with asynchronous tools without a demo application', async () => {
  const traces: ToolTrace[] = [];
  const client: ToolClient = {
    list: async () => [
      {
        name: 'echo',
        description: 'Echo input',
        inputSchema: { type: 'object' },
      },
    ],
    call: async (name, input) => ({
      id: 'trace',
      name,
      input,
      output: input,
      status: 'success',
      durationMs: 0,
    }),
  };
  const result = await executeTask({
    prompt: 'Echo hello',
    instructions: 'Use the echo tool.',
    tools: client,
    onTrace: (trace) => traces.push(trace),
    step: async ({ messages, tools }) => {
      assert.equal(tools[0]?.name, 'echo');
      if (messages.at(-1)?.role === 'tool') {
        assert.equal(messages.at(-1)?.content, '{"value":"hello"}');
        return { content: 'Echoed hello' };
      }
      tools.length = 0;
      return {
        content: null,
        tool_calls: [
          {
            id: 'call',
            type: 'function',
            function: { name: 'echo', arguments: '{"value":"hello"}' },
          },
        ],
      };
    },
  });
  assert.equal(result, 'Echoed hello');
  assert.equal(traces.length, 1);
  assert.deepEqual(traces[0]?.output, { value: 'hello' });
});
