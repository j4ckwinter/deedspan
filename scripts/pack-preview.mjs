import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runNpm } from './npm.ts';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'artifacts/developer-preview');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(output, 'preview-'));
runNpm(['run', 'build:sdk'], { cwd: root, stdio: 'inherit' });
const [packed] = JSON.parse(
  runNpm(
    ['pack', '--ignore-scripts', '--json', '--pack-destination', directory],
    { cwd: root },
  ),
);
const archive = join(directory, packed.filename);
const manifest = {
  package: `${packed.name}@${packed.version}`,
  archive,
  sha256: createHash('sha256')
    .update(await readFile(archive))
    .digest('hex'),
  integrity: packed.integrity,
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  sourceDirty:
    execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    }).trim().length > 0,
  createdAt: new Date().toISOString(),
  files: packed.files.map(({ path }) => path),
};
await writeFile(
  join(directory, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(JSON.stringify(manifest, null, 2));
