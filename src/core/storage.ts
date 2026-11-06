import { z } from 'zod';
import {
  scenarioSchema,
  snapshotSchema,
  toolDescriptorSchema,
  type RunReport,
  type Scenario,
} from './types.js';
import { defaultScenario } from './scenarios.js';

const reportSchema: z.ZodType<RunReport> = z.object({
  id: z.string(),
  scenario: scenarioSchema,
  startedAt: z.string(),
  durationMs: z.number(),
  mode: z.enum(['scripted', 'model']),
  model: z.string(),
  tools: z.array(toolDescriptorSchema),
  initialState: snapshotSchema,
  finalState: snapshotSchema,
  traces: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      input: z.unknown(),
      output: z.unknown(),
      status: z.enum(['success', 'error']),
      durationMs: z.number(),
    }),
  ),
  assertions: z.array(
    z.object({
      name: z.string(),
      passed: z.boolean(),
      expected: z.string(),
      actual: z.string(),
    }),
  ),
  agentMessage: z.string(),
  error: z.string().nullable(),
  status: z.enum(['passed', 'failed', 'error']),
  regression: z.boolean(),
});
const storageSchema = z.object({
  version: z.literal(1),
  scenarios: z.array(scenarioSchema).max(100),
  runs: z.array(reportSchema).max(20),
});
export interface SavedState {
  scenarios: Scenario[];
  runs: RunReport[];
  warning: string | null;
}
export const storageKey = 'short-stack.workbench.v1';
export function loadState(storage: Pick<Storage, 'getItem'>): SavedState {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw)
      return {
        scenarios: [structuredClone(defaultScenario)],
        runs: [],
        warning: null,
      };
    const saved = storageSchema.parse(JSON.parse(raw));
    return {
      scenarios: saved.scenarios.length
        ? saved.scenarios
        : [structuredClone(defaultScenario)],
      runs: saved.runs,
      warning: null,
    };
  } catch {
    return {
      scenarios: [structuredClone(defaultScenario)],
      runs: [],
      warning:
        'Saved data could not be read. Loaded the default scenario; invalid data will be replaced when you save or run.',
    };
  }
}
export function saveState(
  storage: Pick<Storage, 'setItem'>,
  scenarios: Scenario[],
  runs: RunReport[],
) {
  const data = storageSchema.parse({
    version: 1,
    scenarios,
    runs: runs.slice(0, 20),
  });
  storage.setItem(storageKey, JSON.stringify(data));
}
