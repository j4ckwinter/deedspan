import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runNpm } from '../scripts/npm.js';

test('npm launcher preserves paths and shell characters as literal arguments', () => {
  const directory = mkdtempSync(join(tmpdir(), 'npm launcher '));
  const cli = join(directory, 'fake npm.cjs');
  const previous = process.env.npm_execpath;
  try {
    writeFileSync(
      cli,
      'process.stdout.write(JSON.stringify(process.argv.slice(2)))',
    );
    process.env.npm_execpath = cli;
    const args = [
      'install',
      join(directory, 'package with spaces.tgz'),
      '& echo unsafe',
      '$(echo unsafe)',
      '%PATH%',
    ];
    assert.deepEqual(JSON.parse(runNpm(args, { cwd: directory })), args);
    writeFileSync(cli, 'process.exit(7)');
    assert.throws(() => runNpm([]), { status: 7 });
    delete process.env.npm_execpath;
    assert.throws(() => runNpm([]), /Run this script through npm run/);
  } finally {
    if (previous === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
