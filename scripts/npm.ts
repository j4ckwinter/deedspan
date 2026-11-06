import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { isAbsolute } from 'node:path';

export function runNpm(
  args: readonly string[],
  options: Omit<ExecFileSyncOptions, 'encoding' | 'shell'> = {},
) {
  const cli = process.env.npm_execpath;
  if (!cli || !isAbsolute(cli)) {
    throw new Error(
      'Run this script through npm run so npm_execpath identifies the npm CLI.',
    );
  }
  return execFileSync(process.execPath, [cli, ...args], {
    ...options,
    encoding: 'utf8',
    shell: false,
  });
}
