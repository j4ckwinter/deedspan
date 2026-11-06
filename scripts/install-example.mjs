import { runNpm } from './npm.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
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
    { cwd: join(root, 'examples/drafts'), stdio: 'inherit' },
  );
  console.log(
    'Drafts example now consumes the packed SDK. Rerun example:install after SDK changes.',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
