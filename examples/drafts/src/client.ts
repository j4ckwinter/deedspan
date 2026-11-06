import { ToolRegistry, connectWebMCP } from 'deedspan';
import {
  draftsSchema,
  operationsSchema,
  projectsSchema,
  sessionSchema,
  errorSchema,
  type SessionResponse,
} from './contracts.js';
import { registerDraftTools } from './tools.js';
import './style.css';

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const status = element('status');
let csrf = '';
async function request(
  path: string,
  body?: unknown,
  callId?: string,
): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
      ...(callId ? { 'X-Tool-Call-Id': callId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error(errorSchema.parse(result).error);
  return result;
}
const traces: unknown[] = [];
const tools = new ToolRegistry({
  async onTrace(trace) {
    traces.push(trace);
    element('traces').textContent = JSON.stringify(traces.slice(-20), null, 2);
    if (trace.name === 'create_draft') await refresh();
  },
});
registerDraftTools(tools, request);
const connection = await connectWebMCP(tools);
window.addEventListener('pagehide', () => connection.dispose());

async function refresh() {
  const [drafts, approvals, events, calls] = await Promise.all([
    request('/drafts'),
    request('/approvals'),
    request('/events'),
    request('/calls'),
  ]);
  element('drafts').replaceChildren(
    ...draftsSchema.parse(drafts).map((draft) => {
      const item = document.createElement('li');
      item.textContent = `${draft.title} · ${draft.project_id} · ${draft.id}`;
      return item;
    }),
  );
  element('approvals').replaceChildren(
    ...operationsSchema.parse(approvals).map((operation) => {
      const row = document.createElement('p');
      const button = document.createElement('button');
      button.textContent = `Approve creation of “${operation.title}” in ${operation.project_id}`;
      button.onclick = () => {
        void run(async () => {
          await request(`/approvals/${operation.id}`, {});
          const trace = await tools.call('create_draft', {
            operationId: operation.id,
            title: operation.title,
            projectId: operation.project_id,
          });
          if (trace.status === 'error')
            throw new Error(JSON.stringify(trace.output));
          status.textContent =
            'Draft saved. The completed event links to its database record.';
          await refresh();
        });
      };
      const identifier = document.createElement('small');
      identifier.textContent = ` Operation ${operation.id}`;
      row.append(button, identifier);
      return row;
    }),
  );
  element('events').textContent = JSON.stringify({ events, calls }, null, 2);
}
async function run(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : 'Request failed';
  }
}
async function signedIn(session: SessionResponse) {
  csrf = session.csrf;
  element('login').hidden = true;
  element('workspace').hidden = false;
  status.textContent = `Signed in as ${session.user.name}. ${connection.status}`;
  const projects = projectsSchema.parse(await request('/projects'));
  const select = document.querySelector<HTMLSelectElement>(
    'select[name=project]',
  )!;
  select.replaceChildren(
    ...projects.map((p) => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      return option;
    }),
  );
  await refresh();
}
element<HTMLFormElement>('login').onsubmit = (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  void run(async () => {
    await signedIn(
      sessionSchema.parse(
        await request('/login', {
          username: data.get('username'),
          password: data.get('password'),
        }),
      ),
    );
  });
};
element<HTMLFormElement>('create').onsubmit = (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  void run(async () => {
    const trace = await tools.call('create_draft', {
      operationId: crypto.randomUUID(),
      projectId: data.get('project'),
      title: data.get('title'),
    });
    if (trace.status === 'error') throw new Error(JSON.stringify(trace.output));
    status.textContent = 'Review and approve the requested operation below.';
  });
};
try {
  await signedIn(sessionSchema.parse(await request('/session')));
} catch {
  status.textContent =
    'Sign in with alice or bob and the configured demo password.';
}

element('logout').onclick = () => {
  void run(async () => {
    await request('/logout', {});
    csrf = '';
    location.reload();
  });
};

element('refresh').onclick = () => {
  void run(refresh);
};
