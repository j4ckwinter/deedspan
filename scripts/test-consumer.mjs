import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { runNpm } from './npm.ts';

const root = resolve(import.meta.dirname, '..');
if (process.argv.length > 3)
  throw new Error('Usage: npm run test:consumer -- [archive.tgz]');
const directory = await mkdtemp(join(tmpdir(), 'deedspan-consumer-'));
try {
  let archive;
  if (process.argv[2]) archive = resolve(process.argv[2]);
  else {
    runNpm(['run', 'build:sdk'], { cwd: root, stdio: 'inherit' });
    const [packed] = JSON.parse(
      runNpm(
        ['pack', '--ignore-scripts', '--json', '--pack-destination', directory],
        { cwd: root },
      ),
    );
    archive = join(directory, packed.filename);
  }
  const integrity = `sha512-${createHash('sha512')
    .update(await readFile(archive))
    .digest('base64')}`;
  const consumer = join(directory, 'inventory');
  await cp(join(root, 'examples/inventory'), consumer, {
    recursive: true,
    filter: (source) =>
      !relative(join(root, 'examples/inventory'), source)
        .split(sep)
        .some((part) =>
          ['node_modules', 'dist', '.data', 'package-lock.json'].includes(part),
        ),
  });
  runNpm(
    [
      'install',
      '--ignore-scripts',
      '--no-save',
      '--package-lock=false',
      '--no-audit',
      '--no-fund',
      archive,
    ],
    {
      cwd: consumer,
      stdio: 'inherit',
    },
  );
  const installed = await realpath(join(consumer, 'node_modules/deedspan'));
  assert.equal(
    installed,
    join(consumer, 'node_modules/deedspan'),
    'SDK must be an unpacked archive, not a repository symlink',
  );
  const manifest = JSON.parse(
    await readFile(join(installed, 'package.json'), 'utf8'),
  );
  const expected = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  );
  assert.equal(manifest.version, expected.version);
  for (const guide of [
    'integration.md',
    'developer-preview.md',
    'verification.md',
  ])
    assert((await readFile(join(installed, 'docs', guide), 'utf8')).length > 0);
  for (const script of ['build', 'test', 'demo']) {
    runNpm(['run', script], { cwd: consumer, stdio: 'inherit' });
  }
  console.log(
    JSON.stringify({
      status: 'passed',
      package: `${manifest.name}@${manifest.version}`,
      archive: basename(archive),
      integrity,
      verification:
        'inventory build, tests and demo outside the SDK repository',
    }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
