import { runNpm } from './npm.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const example = process.argv[2] ?? 'drafts';
if (!['drafts', 'inventory'].includes(example) || process.argv.length > 3)
  throw new Error('Choose the drafts or inventory example.');
const directory = await mkdtemp(join(tmpdir(), 'deedspan-example-'));
try {
  runNpm(['run', 'build:sdk'], { cwd: root, stdio: 'inherit' });
  const [packed] = Object.values(
    JSON.parse(
      runNpm(
        ['pack', '--ignore-scripts', '--json', '--pack-destination', directory],
        { cwd: root, encoding: 'utf8' },
      ),
    ),
  );
  runNpm(
    [
      'install',
      '--no-save',
      '--package-lock=false',
      join(directory, packed.filename),
    ],
    { cwd: join(root, 'examples', example), stdio: 'inherit' },
  );
  console.log(
    `${example} example now consumes the packed SDK. Reinstall after SDK changes.`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
