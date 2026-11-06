import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDemo } from '../src/demo/store.js';
import { runScenario } from '../src/core/runner.js';
import { scriptedStep } from '../src/core/agents.js';
import { defaultScenario } from '../src/core/scenarios.js';
import { scenarioSchema } from '../src/core/types.js';

const args = process.argv.slice(2);
const scenarioPath = args.find((a) => !a.startsWith('--'));
const scenario = scenarioPath
  ? scenarioSchema.parse(
      JSON.parse(await readFile(resolve(scenarioPath), 'utf8')),
    )
  : defaultScenario;
const report = await runScenario({
  demo: createDemo(),
  scenario,
  mode: 'scripted',
  model: 'scripted-demo-v1',
  step: scriptedStep,
  regression: args.includes('--regression'),
});
if (args.includes('--output'))
  await writeFile(
    'scenario-report.json',
    JSON.stringify(report, null, 2) + '\n',
  );
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'passed' ? 0 : 1;
