import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemo } from '../src/demo/store.js';
import { runScenario } from '../src/core/runner.js';
import { scriptedStep } from '../src/core/agents.js';
import { defaultScenario } from '../src/core/scenarios.js';
import { loadState, saveState, storageKey } from '../src/core/storage.js';
import type { AgentStep } from '../src/core/types.js';

function run(
  demo = createDemo(),
  regression = false,
  step: AgentStep = scriptedStep,
) {
  return runScenario({
    demo,
    scenario: defaultScenario,
    mode: 'scripted',
    model: 'scripted-demo-v1',
    step,
    regression,
  });
}
test('scenario creates a real draft, records discovery and resets fixtures on rerun', async () => {
  const demo = createDemo();
  const first = await run(demo);
  assert.equal(first.status, 'passed');
  assert.deepEqual(
    first.traces.map((t) => t.name),
    ['find_project', 'create_draft', 'get_draft'],
  );
  assert.equal(first.tools.length, 3);
  assert.equal(first.initialState.drafts.length, 0);
  assert.equal(demo.snapshot().drafts.length, 1);
  const second = await run(demo);
  assert.equal(second.status, 'passed');
  assert.equal(second.finalState.drafts.length, 1);
  assert.notEqual(
    first.finalState.drafts[0]?.id,
    second.finalState.drafts[0]?.id,
  );
});
test('wrong-project regression fails independent assertion even when agent reports completion', async () => {
  const report = await run(createDemo(), true);
  assert.equal(report.status, 'failed');
  assert.match(report.agentMessage, /created/);
  assert.equal(
    report.assertions.find((a) => a.name === 'Project assignment')?.passed,
    false,
  );
  assert.equal(report.finalState.drafts[0]?.projectId, 'engineering');
});
test('success text without tool execution cannot pass', async () => {
  const report = await run(createDemo(), false, async () => ({
    content: 'Done!',
  }));
  assert.equal(report.status, 'failed');
});
test('scripted agent follows prompt rather than expected assertion', async () => {
  const report = await runScenario({
    demo: createDemo(),
    scenario: {
      ...defaultScenario,
      expected: { ...defaultScenario.expected, title: 'A different title' },
    },
    mode: 'scripted',
    model: 'script',
    step: scriptedStep,
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.finalState.drafts[0]?.title, 'November launch notes');
});
test('invalid arguments and permission denials do not mutate the application', async () => {
  const demo = createDemo();
  assert.equal(
    (
      await demo.registry.call('create_draft', {
        projectId: 'marketing',
        title: '',
      })
    ).status,
    'error',
  );
  demo.setCanWrite(false);
  const denied = await demo.registry.call('create_draft', {
    projectId: 'marketing',
    title: 'Notes',
  });
  assert.equal(denied.status, 'error');
  assert.equal(demo.snapshot().drafts.length, 0);
});
test('agent call loop has a hard limit', async () => {
  const report = await run(createDemo(), false, async () => ({
    content: null,
    tool_calls: [
      {
        id: 'call',
        type: 'function',
        function: { name: 'find_project', arguments: '{"name":"Marketing"}' },
      },
    ],
  }));
  assert.equal(report.status, 'error');
  assert.match(report.error ?? '', /turn limit/);
});
test('abort after model response prevents tool mutation and releases runner', async () => {
  const demo = createDemo();
  const controller = new AbortController();
  const report = await runScenario({
    demo,
    scenario: defaultScenario,
    mode: 'model',
    model: 'test',
    signal: controller.signal,
    step: async () => {
      controller.abort();
      return {
        content: null,
        tool_calls: [
          {
            id: '1',
            type: 'function',
            function: {
              name: 'create_draft',
              arguments: '{"projectId":"marketing","title":"Should not exist"}',
            },
          },
        ],
      };
    },
  });
  assert.equal(report.error, 'Run cancelled');
  assert.equal(demo.snapshot().drafts.length, 0);
  assert.equal((await run(demo)).status, 'passed');
});
test('concurrent scenarios cannot reset each other', async () => {
  const demo = createDemo();
  let finish: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const first = run(demo, false, async () => {
    await pending;
    return { content: 'Done' };
  });
  await assert.rejects(run(demo), /already running/);
  finish?.();
  await first;
});
test('saved scenarios and traces survive storage; corrupt data is handled visibly', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const report = await run();
  saveState(storage, [defaultScenario], [report]);
  assert.deepEqual(loadState(storage).runs, [report]);
  values.set('short-stack.workbench.v1', values.get(storageKey)!);
  values.delete(storageKey);
  assert.deepEqual(loadState(storage).runs, [report]);
  saveState(storage, [defaultScenario], []);
  assert.deepEqual(loadState(storage).runs, []);
  values.set(storageKey, '{bad json');
  assert.match(loadState(storage).warning ?? '', /could not be read/);
});

test('regression routes Engineering drafts to a different project too', async () => {
  const report = await runScenario({
    demo: createDemo(),
    scenario: {
      ...defaultScenario,
      prompt: 'Create November launch notes in the Engineering project.',
      expected: { ...defaultScenario.expected, projectId: 'engineering' },
    },
    mode: 'scripted',
    model: 'scripted-demo-v1',
    step: scriptedStep,
    regression: true,
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.finalState.drafts[0]?.projectId, 'marketing');
});

test('fixture setup failure releases the scenario lock and regression mode', async () => {
  const demo = createDemo();
  const reset = demo.reset;
  demo.reset = () => {
    throw new Error('Fixture unavailable');
  };
  await assert.rejects(run(demo, true), /Fixture unavailable/);
  demo.reset = reset;
  assert.equal((await run(demo)).status, 'passed');
});

test('already-cancelled scenarios do not reset existing application state', async () => {
  const demo = createDemo();
  await run(demo);
  const before = demo.snapshot();
  await assert.rejects(
    runScenario({
      demo,
      scenario: defaultScenario,
      mode: 'scripted',
      model: 'scripted-demo-v1',
      step: scriptedStep,
      signal: AbortSignal.abort(),
    }),
    { name: 'AbortError' },
  );
  assert.deepEqual(demo.snapshot(), before);
  assert.equal((await run(demo)).status, 'passed');
});
