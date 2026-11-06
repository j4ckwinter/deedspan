import assert from 'node:assert/strict';
import { runNpm } from './npm.ts';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'deedspan-package-'));
const run = (command, args, cwd = directory) =>
  command === 'npm'
    ? runNpm(args, { cwd, stdio: 'pipe' })
    : execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
const install = (...packages) =>
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    ...packages,
  ]);

try {
  run('npm', ['run', 'build:sdk'], root);
  const packed = Object.values(
    JSON.parse(
      run(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', directory],
        root,
      ),
    ),
  )[0];
  assert(packed.files.some(({ path }) => path === 'lib/index.d.ts'));
  assert(packed.files.some(({ path }) => path === 'lib/react.js'));
  assert(
    !packed.files.some(({ path }) =>
      /^(src|server|tests|examples)\//.test(path),
    ),
  );
  const archive = join(directory, packed.filename);
  const consumer = join(directory, 'consumer');
  await mkdir(consumer);
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  install(archive, `zod@${manifest.dependencies.zod}`);
  const dependencyTree = JSON.parse(run('npm', ['ls', '--all', '--json']));
  assert(!dependencyTree.dependencies.react, 'Core must work without React');
  await writeFile(
    join(consumer, 'core.ts'),
    `import assert from 'node:assert/strict';
import { ToolRegistry, type ToolTrace } from 'deedspan';
import { z } from 'zod';
const registry = new ToolRegistry();
registry.register({ name: 'greet', description: 'Greet someone', input: z.object({name: z.string()}), execute: ({name}) => ({message: 'Hello ' + name}) });
const trace: ToolTrace = await registry.call('greet', {name: 'Ada'});
assert.equal(trace.status, 'success');
assert.deepEqual(trace.output, {message: 'Hello Ada'});
assert.equal((await registry.call('greet', {name: 1})).status, 'error');
`,
  );
  run(process.execPath, ['consumer/core.ts']);
  install(`@types/node@${manifest.devDependencies['@types/node']}`);
  const typecheck = (file) =>
    run(process.execPath, [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--target',
      'ES2023',
      '--module',
      'NodeNext',
      '--types',
      'node',
      file,
    ]);
  typecheck('consumer/core.ts');
  install(
    `react@${manifest.devDependencies.react}`,
    `@types/react@${manifest.devDependencies['@types/react']}`,
  );
  await writeFile(
    join(consumer, 'react.ts'),
    `import { useRegisteredTool } from 'deedspan/react';
import { ToolRegistry } from 'deedspan';
import { z } from 'zod';
export function Component() {
  useRegisteredTool(new ToolRegistry(), {name: 'noop', description: 'No operation', input: z.object({}), execute: () => null});
  return null;
}
if (typeof useRegisteredTool !== 'function') throw new Error('Missing React export');
`,
  );
  run(process.execPath, ['consumer/react.ts']);
  typecheck('consumer/react.ts');
  console.log(
    'Packed SDK verified: standalone runtime, declarations, optional React entry point, and package contents.',
  );
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  await rm(directory, { recursive: true, force: true });
}
