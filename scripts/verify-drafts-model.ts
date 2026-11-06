import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createApp } from '../examples/drafts/src/app.js';
import { DraftStore } from '../examples/drafts/src/store.js';
import {
  createDraftSchema,
  draftsSchema,
  operationsSchema,
  sessionSchema,
} from '../examples/drafts/src/contracts.js';
import { createApiApp } from '../server/app.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const locationSchema = z.object({
  taskFile: z.string(),
  operationId: z.uuid(),
});
const manifestSchema = locationSchema.omit({ taskFile: true }).extend({
  version: z.literal(1),
  title: z.string(),
  origin: z.url(),
  before: draftsSchema,
});
const tagsSchema = z.object({
  models: z.array(z.object({ name: z.string(), digest: z.string().min(1) })),
});
const versionSchema = z.object({ version: z.string().min(1) });
const showSchema = z.object({
  template: z.string(),
  parameters: z.string().optional(),
});
const save = (directory: string, name: string, value: unknown) =>
  writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n');
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}
function localEndpoint(value: string) {
  const url = new URL(value);
  assert(
    url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash,
    '--ollama must be an HTTP localhost or 127.0.0.1 origin',
  );
  return url.origin;
}

type TrialResult = { title: string; directory: string } & (
  { status: 'passed'; draftId: string } | { status: 'failed'; error: string }
);

export async function runModelVerification(options: {
  model: string;
  ollama?: string;
  output?: string;
  titles?: string[];
}) {
  const titles = z
    .array(createDraftSchema.shape.title)
    .min(1)
    .parse(
      options.titles ?? [
        'Model verification launch notes',
        'Model verification autumn campaign',
      ],
    );
  const output = resolve(options.output ?? 'artifacts/model-checks');
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(join(output, 'run-'));
  const trials: TrialResult[] = [];
  const report: {
    directory: string;
    model: string;
    approval: string;
    startedAt: string;
    status: 'passed' | 'failed';
    setupError: string | null;
    trials: TrialResult[];
  } = {
    directory,
    model: options.model,
    approval: 'automated test operator, not human',
    startedAt: new Date().toISOString(),
    status: 'failed',
    setupError: null,
    trials,
  };
  await save(directory, 'report.json', report);
  let endpoint: string;
  try {
    endpoint = localEndpoint(options.ollama ?? 'http://127.0.0.1:11434');
    z.string().min(1).parse(options.model);
    const metadata = async (path: string, body?: unknown): Promise<unknown> => {
      try {
        const response = await fetch(`${endpoint}/api/${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(10000),
        });
        const raw = await response.text();
        await save(directory, `${path}.json`, {
          status: response.status,
          body: raw,
        });
        assert(response.ok, `Ollama ${path}: HTTP ${response.status}`);
        return JSON.parse(raw);
      } catch (error) {
        await save(directory, `${path}-error.json`, {
          error: errorMessage(error),
        });
        throw error;
      }
    };
    const version = versionSchema.parse(await metadata('version'));
    const tags = tagsSchema.parse(await metadata('tags'));
    const selected = tags.models.find((model) => model.name === options.model);
    assert(
      selected,
      `Exact model tag ${options.model} was not found in Ollama`,
    );
    const show = showSchema.parse(
      await metadata('show', { model: options.model }),
    );
    await save(directory, 'identity.json', {
      endpoint,
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      capturedAt: new Date().toISOString(),
      configuration: {
        baseUrl: `${endpoint}/v1`,
        model: options.model,
        inferenceTimeoutMs: 60000,
        childTimeoutMs: 180000,
      },
      version: version.version,
      ...selected,
      ...show,
    });
  } catch (error) {
    report.setupError = errorMessage(error);
    for (const title of titles)
      trials.push({
        title,
        directory,
        status: 'failed',
        error: errorMessage(error),
      });
    await save(directory, 'report.json', report);
    return report;
  }

  for (const [index, title] of titles.entries()) {
    const trialDirectory = join(directory, `trial-${index + 1}`);
    await mkdir(trialDirectory);
    const servers: Server[] = [];
    let store: DraftStore | undefined;
    let temporary: string | undefined;
    const inferenceAbort = new AbortController();
    const inFlight = new Set<Promise<Response>>();
    try {
      temporary = await mkdtemp(join(tmpdir(), 'draft-model-'));
      store = new DraftStore(join(temporary, 'drafts.sqlite'));
      const password = randomUUID();
      store.seed(password);
      const appServer = createServer();
      servers.push(appServer);
      const origin = await listen(appServer);
      appServer.on('request', createApp(store, origin));
      let inference = 0;
      const capture: typeof fetch = async (input, init) => {
        const prefix = `model-${++inference}`;
        await save(trialDirectory, `${prefix}-request.json`, {
          url: String(input),
          body: init?.body,
        });
        try {
          const response = await fetch(input, {
            ...init,
            redirect: 'error',
            signal: AbortSignal.any([
              inferenceAbort.signal,
              ...(init?.signal ? [init.signal] : []),
            ]),
          });
          const raw = await response.text();
          await save(trialDirectory, `${prefix}-response.json`, {
            status: response.status,
            body: raw,
          });
          return new Response(raw, {
            status: response.status,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (error) {
          await save(trialDirectory, `${prefix}-error.json`, {
            error: errorMessage(error),
          });
          throw error;
        }
      };
      const transport: typeof fetch = async (input, init) => {
        const pending = capture(input, init);
        inFlight.add(pending);
        try {
          return await pending;
        } finally {
          inFlight.delete(pending);
        }
      };
      const proxy = createServer(
        createApiApp(
          { baseUrl: `${endpoint}/v1`, model: options.model },
          transport,
        ),
      );
      servers.push(proxy);
      const workbench = await listen(proxy);
      const login = await fetch(`${origin}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ username: 'alice', password }),
      });
      assert(login.ok, 'Test operator login failed');
      const session = sessionSchema.parse(await login.json());
      const cookie = login.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
      const request = async (
        path: string,
        body?: unknown,
      ): Promise<unknown> => {
        const response = await fetch(`${origin}/api${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: origin,
            Cookie: cookie,
            'X-CSRF-Token': session.csrf,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        assert(response.ok, `Test operator ${path}: HTTP ${response.status}`);
        return response.json();
      };
      const snapshot = async (name: string) => {
        const state = {
          drafts: draftsSchema.parse(await request('/drafts')),
          pending: operationsSchema.parse(await request('/approvals')),
          calls: await request('/calls'),
          events: await request('/events'),
        };
        await save(trialDirectory, `${name}.json`, state);
        return state;
      };
      const run = async (name: string, args: string[]) => {
        const result = await new Promise<{
          exitCode: number | string | null;
          stdout: string;
          stderr: string;
          error: string | null;
        }>((resolve) => {
          execFile(
            process.execPath,
            ['--import', 'tsx', 'scripts/run-drafts-agent.ts', ...args],
            {
              cwd: repository,
              env: {
                ...process.env,
                DRAFTS_PASSWORD: password,
                DRAFTS_ORIGIN: origin,
                WORKBENCH_ORIGIN: workbench,
                DRAFTS_RUN_DIR: join(trialDirectory, 'tasks'),
              },
              timeout: 180000,
              killSignal: 'SIGKILL',
              maxBuffer: 8 * 1024 * 1024,
            },
            (error, stdout, stderr) =>
              resolve({
                exitCode: error?.code ?? (error ? null : 0),
                stdout,
                stderr,
                error: error ? errorMessage(error) : null,
              }),
          );
        });
        await save(trialDirectory, `${name}.json`, result);
        return result;
      };
      await snapshot('before');
      const first = await run('initial-cli', ['--', title]);
      const pending = await snapshot('before-approval');
      assert(
        first.exitCode !== 0 &&
          /Approval requires.*--resume/.test(first.stderr),
        `Initial CLI must stop for approval: ${first.stderr || first.error || 'unexpected successful exit'}`,
      );
      const locations = first.stdout.split('\n').flatMap((line) => {
        try {
          const parsed = locationSchema.safeParse(JSON.parse(line));
          return parsed.success ? [parsed.data] : [];
        } catch {
          return [];
        }
      });
      assert.equal(locations.length, 1, 'CLI must emit one task manifest');
      const location = locations[0]!;
      const manifest = manifestSchema.parse(
        JSON.parse(await readFile(location.taskFile, 'utf8')),
      );
      assert.equal(manifest.title, title);
      assert.equal(manifest.origin, origin);
      assert.equal(manifest.operationId, location.operationId);
      assert.deepEqual(manifest.before, []);
      assert.equal(
        pending.drafts.length,
        0,
        'No draft may exist before approval',
      );
      assert.equal(
        pending.pending.length,
        1,
        'Exactly one operation must await approval',
      );
      const operation = pending.pending[0]!;
      assert.equal(operation.id, location.operationId);
      assert.equal(operation.title, title);
      assert.equal(operation.project_id, 'marketing');
      assert.equal(operation.user_id, 'alice');
      assert.equal(operation.status, 'pending');
      assert.equal(operation.draft_id, null);
      await save(trialDirectory, 'approval.json', {
        actor: report.approval,
        operation: await request(`/approvals/${operation.id}`, {}),
      });
      const second = await run('resumed-cli', ['--resume', location.taskFile]);
      const after = await snapshot('after');
      assert.equal(second.exitCode, 0, second.stderr);
      assert.match(second.stdout, /"status": "passed"/);
      assert.equal(after.pending.length, 0);
      assert.equal(after.drafts.length, 1);
      const draft = after.drafts[0]!;
      assert.equal(draft.title, title);
      assert.equal(draft.project_id, 'marketing');
      trials.push({
        title,
        directory: trialDirectory,
        status: 'passed',
        draftId: draft.id,
      });
    } catch (error) {
      trials.push({
        title,
        directory: trialDirectory,
        status: 'failed',
        error: errorMessage(error),
      });
      await save(trialDirectory, 'failure.json', {
        error: errorMessage(error),
      });
    } finally {
      inferenceAbort.abort(new Error('Model verification trial finished'));
      const cleanupErrors: string[] = [];
      const attempt = async (action: () => unknown) => {
        try {
          await action();
        } catch (error) {
          cleanupErrors.push(errorMessage(error));
        }
      };
      await attempt(async () => {
        if (store) {
          const alice = { id: 'alice', name: 'Alice' };
          await save(trialDirectory, 'final-state.json', {
            drafts: store.drafts(alice),
            pending: store.pending(alice),
            calls: store.calls(alice),
            events: store.events(alice),
          });
        }
      });
      await Promise.all(servers.map((server) => attempt(() => close(server))));
      await Promise.allSettled(inFlight);
      await attempt(() => store?.close());
      await attempt(async () => {
        if (temporary) await rm(temporary, { recursive: true, force: true });
      });
      if (cleanupErrors.length) {
        const previous = trials[index];
        trials[index] = {
          title,
          directory: trialDirectory,
          status: 'failed',
          error: [
            previous?.status === 'failed' ? previous.error : '',
            ...cleanupErrors,
          ]
            .filter(Boolean)
            .join('\n'),
        };
        await save(trialDirectory, 'cleanup-errors.json', cleanupErrors);
      }
    }
    await save(directory, 'report.json', report);
  }
  report.status = trials.every((trial) => trial.status === 'passed')
    ? 'passed'
    : 'failed';
  await save(directory, 'report.json', report);
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values, positionals } = parseArgs({
    options: {
      model: { type: 'string' },
      output: { type: 'string' },
      ollama: { type: 'string' },
    },
    allowPositionals: true,
  });
  assert(
    values.model,
    'Usage: npm run model:check -- --model <exact-tag> [--output directory] [--ollama http://127.0.0.1:11434] [titles...]',
  );
  const report = await runModelVerification({
    model: values.model,
    ...(values.output ? { output: values.output } : {}),
    ...(values.ollama ? { ollama: values.ollama } : {}),
    ...(positionals.length ? { titles: positionals } : {}),
  });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
