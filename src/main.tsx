import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { createDemo } from './demo/store.js';
import { connectWebMCP } from 'deedspan';
import { runScenario } from './core/runner.js';
import { scriptedStep, modelStep } from './core/agents.js';
import { loadState, saveState, savedStateLimits } from './core/storage.js';
import {
  scenarioInputSchema,
  type RunMode,
  type RunReport,
  type Scenario,
  type ScenarioInput,
} from './core/types.js';
import { Workbench } from './ui/Workbench.js';
import './ui/styles.css';

const demo = createDemo();
function App() {
  const [initial] = useState(() => loadState(localStorage));
  const [scenarios, setScenarios] = useState(initial.scenarios);
  const [runs, setRuns] = useState(initial.runs);
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    initial.scenarios[0]?.id ?? 'launch-notes',
  );
  const [snapshot, setSnapshot] = useState(demo.snapshot());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(initial.warning);
  const [webmcpStatus, setWebmcpStatus] = useState('Checking browser support');
  const [modelLabel, setModelLabel] = useState('Configured model');
  const active = useRef(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => demo.subscribe(() => setSnapshot(demo.snapshot())), []);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void connectWebMCP(demo.registry)
      .then((connection) => {
        if (disposed) connection.dispose();
        else {
          cleanup = connection.dispose;
          setWebmcpStatus(connection.status);
        }
      })
      .catch(() => {
        if (!disposed)
          setWebmcpStatus('WebMCP registration failed; local tools available');
      });
    void fetch('/api/config')
      .then((r) => r.json())
      .then((data: unknown) => {
        const parsed = z.object({ model: z.string() }).parse(data);
        if (!disposed) setModelLabel(parsed.model);
      })
      .catch(() => {
        if (!disposed) setModelLabel('Model server unavailable');
      });
    return () => {
      disposed = true;
      cleanup?.();
      abort.current?.abort();
    };
  }, []);
  function persist(nextScenarios: Scenario[], nextRuns: RunReport[]) {
    try {
      saveState(localStorage, nextScenarios, nextRuns);
    } catch {
      setError(
        'Browser storage is full or unavailable. This session still works, but changes have not been saved. Export important reports.',
      );
    }
  }
  function saveScenario(input: ScenarioInput) {
    if (active.current) return;
    const parsed = scenarioInputSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    if (scenarios.length >= savedStateLimits.scenarios) {
      setError('Scenario limit reached. Delete a scenario first.');
      return;
    }
    const scenario: Scenario = {
      ...parsed.data,
      id: crypto.randomUUID(),
      fixture: 'launch-notes-v1',
    };
    const next = [...scenarios, scenario];
    setScenarios(next);
    setSelectedScenarioId(scenario.id);
    setError(null);
    persist(next, runs);
  }
  async function run(mode: RunMode, regression: boolean) {
    if (active.current) return;
    const scenario = scenarios.find((s) => s.id === selectedScenarioId);
    if (!scenario) return;
    active.current = true;
    setRunning(true);
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const report = await runScenario({
        demo,
        scenario,
        mode,
        model: mode === 'scripted' ? 'scripted-demo-v1' : modelLabel,
        step: mode === 'scripted' ? scriptedStep : modelStep,
        regression,
        signal: controller.signal,
      });
      const next = [report, ...runs].slice(0, savedStateLimits.runs);
      setRuns(next);
      persist(scenarios, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Run failed');
    } finally {
      active.current = false;
      setRunning(false);
      abort.current = null;
    }
  }
  return (
    <Workbench
      scenarios={scenarios}
      selectedScenarioId={selectedScenarioId}
      tools={demo.registry.list()}
      snapshot={snapshot}
      runs={runs}
      running={running}
      error={error}
      webmcpStatus={webmcpStatus}
      modelLabel={modelLabel}
      onSelectScenario={(id) => {
        if (!active.current) setSelectedScenarioId(id);
      }}
      onSaveScenario={saveScenario}
      onDeleteScenario={(id) => {
        if (active.current || scenarios.length <= 1) return;
        const next = scenarios.filter((s) => s.id !== id);
        setScenarios(next);
        setSelectedScenarioId(next[0]?.id ?? 'launch-notes');
        persist(next, runs);
      }}
      onRun={(mode, regression) => {
        void run(mode, regression);
      }}
      onCancel={() => abort.current?.abort()}
      onReset={() => {
        if (!active.current) demo.reset();
      }}
      onManualCall={async (name, input) => {
        if (active.current)
          throw new Error('Wait for the active run to finish');
        active.current = true;
        setRunning(true);
        try {
          return await demo.registry.call(name, input);
        } finally {
          active.current = false;
          setRunning(false);
        }
      }}
    />
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Application root missing');
createRoot(root).render(<App />);
