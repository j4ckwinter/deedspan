import { ToolRegistry, connectWebMCP } from 'deedspan';
import {
  draftsSchema,
  draftSchema,
  operationsSchema,
  updateOperationsSchema,
  updateDraftResultSchema,
  projectsSchema,
  sessionSchema,
  errorSchema,
  type SessionResponse,
} from './contracts.js';
import { registerDraftTools } from './tools.js';
import { registerDraftUpdateTools } from './update-tools.js';
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
    if (trace.name === 'create_draft' || trace.name === 'update_draft')
      await refresh();
  },
});
registerDraftTools(tools, request);
registerDraftUpdateTools(tools, request);
const connection = await connectWebMCP(tools);
window.addEventListener('pagehide', () => connection.dispose());

async function refresh() {
  const [drafts, approvals, updates, events, calls] = await Promise.all([
    request('/drafts'),
    request('/approvals'),
    request('/draft-updates/approvals'),
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
  element('update-approvals').replaceChildren(
    ...updateOperationsSchema.parse(updates).map((operation) => {
      const row = document.createElement('p');
      const description = document.createElement('span');
      description.textContent = `Change “${operation.previous_title}” to “${operation.title}” in ${operation.project_id} (version ${operation.expected_version}). `;
      const approve = document.createElement('button');
      approve.textContent =
        operation.status === 'approved'
          ? `Retry approved update to “${operation.title}”`
          : `Approve update to “${operation.title}”`;
      approve.onclick = () => {
        void run(async () => {
          await request(`/draft-updates/${operation.id}/approve`, {});
          const trace = await tools.call('update_draft', {
            operationId: operation.id,
            draftId: operation.draft_id,
            expectedVersion: operation.expected_version,
            title: operation.title,
          });
          if (trace.status === 'error')
            throw new Error(JSON.stringify(trace.output));
          const result = updateDraftResultSchema.parse(trace.output);
          if (result.status === 'completed') {
            const retrieved = await tools.call('get_updated_draft', {
              id: result.draftId,
            });
            if (retrieved.status === 'error')
              throw new Error(JSON.stringify(retrieved.output));
            const draft = draftSchema.parse(retrieved.output);
            if (
              draft.id !== result.draftId ||
              draft.title !== operation.title ||
              draft.version !== result.version
            )
              throw new Error(
                'The saved draft changed before verification. Refresh to review it.',
              );
            status.textContent = 'Update saved and verified.';
          } else {
            status.textContent = updateStatus(result.status);
          }
          await refresh();
        });
      };
      const reject = document.createElement('button');
      reject.textContent = `Reject update to “${operation.title}”`;
      reject.onclick = () => {
        void run(async () => {
          await request(`/draft-updates/${operation.id}/reject`, {});
          status.textContent = 'Update rejected. The draft was not changed.';
          await refresh();
        });
      };
      row.append(description, approve);
      if (operation.status === 'pending') row.append(reject);
      return row;
    }),
  );
  await findDrafts();
  element('events').textContent = JSON.stringify({ events, calls }, null, 2);
}
let foundDrafts: ReturnType<typeof draftsSchema.parse> = [];
async function findDrafts() {
  const query = element<HTMLInputElement>('draft-query').value.trim();
  if (query) {
    const trace = await tools.call('search_drafts', { query });
    if (trace.status === 'error') throw new Error(JSON.stringify(trace.output));
    foundDrafts = draftsSchema.parse(trace.output);
  } else {
    foundDrafts = [];
  }
  const select = element<HTMLSelectElement>('update-draft');
  const selected = select.value;
  select.replaceChildren(
    ...foundDrafts.map((draft) => {
      const option = document.createElement('option');
      option.value = draft.id;
      option.textContent = `${draft.title} · ${draft.project_id} · version ${draft.version}`;
      return option;
    }),
  );
  if (foundDrafts.some((draft) => draft.id === selected))
    select.value = selected;
  element<HTMLButtonElement>('request-update').disabled =
    foundDrafts.length === 0;
}
function updateStatus(
  status: 'confirmation_required' | 'rejected' | 'conflict',
) {
  if (status === 'rejected')
    return 'Update rejected. The draft was not changed.';
  if (status === 'conflict')
    return 'Update not applied: the draft has changed. Find it again and request a new update.';
  return 'Review the current title and proposed title below before approving.';
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
element<HTMLFormElement>('find-drafts').onsubmit = (event) => {
  event.preventDefault();
  void run(findDrafts);
};
element<HTMLFormElement>('update').onsubmit = (event) => {
  event.preventDefault();
  void run(async () => {
    const selected = foundDrafts.find(
      (draft) => draft.id === element<HTMLSelectElement>('update-draft').value,
    );
    if (!selected) throw new Error('Find and select a draft first.');
    const trace = await tools.call('update_draft', {
      operationId: crypto.randomUUID(),
      draftId: selected.id,
      expectedVersion: selected.version,
      title: element<HTMLInputElement>('update-title').value,
    });
    if (trace.status === 'error') throw new Error(JSON.stringify(trace.output));
    const result = updateDraftResultSchema.parse(trace.output);
    status.textContent =
      result.status === 'completed'
        ? 'Update completed. Refresh to inspect the saved draft.'
        : updateStatus(result.status);
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
