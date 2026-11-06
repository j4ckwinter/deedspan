import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const directory = await mkdtemp(join(tmpdir(), 'short-stack-example-'));
try {
  execFileSync('npm', ['run', 'build:sdk'], { cwd: root, stdio: 'inherit' });
  const [packed] = Object.values(
    JSON.parse(
      execFileSync(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', directory],
        { cwd: root, encoding: 'utf8' },
      ),
    ),
  );
  execFileSync(
    'npm',
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
