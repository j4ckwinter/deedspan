import type {
  RunMode,
  RunReport,
  Scenario,
  ScenarioInput,
  Snapshot,
  ToolDescriptor,
  ToolTrace,
} from '../core/types.js';

export interface WorkbenchProps {
  scenarios: Scenario[];
  selectedScenarioId: string;
  tools: ToolDescriptor[];
  snapshot: Snapshot;
  runs: RunReport[];
  running: boolean;
  error: string | null;
  webmcpStatus: string;
  modelLabel: string;
  onSelectScenario: (id: string) => void;
  onSaveScenario: (input: ScenarioInput) => void;
  onDeleteScenario: (id: string) => void;
  onRun: (mode: RunMode, regression: boolean) => void;
  onCancel: () => void;
  onReset: () => void;
  onManualCall: (name: string, input: unknown) => Promise<ToolTrace>;
}
