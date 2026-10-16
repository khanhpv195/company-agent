import type {
  CommentInput,
  ConnectInput,
  CreateTaskInput,
  LoginInput,
  MoveTaskInput,
  RealtimeEvent,
  SchedulerState,
  SendMessageInput,
  Session,
  UpdateAgentInput,
  UpdateTaskInput,
} from '@repo/shared';
import { HttpError, MockBackend } from './backend';
import {
  connect,
  disconnect,
  ensureDm,
  findChat,
  listRooms,
  markRead,
  sendDraft,
  sendMessage,
} from './chat';

/**
 * In-process mock of the REST API, enabled with VITE_MOCK=1. `apiRequest` sends requests
 * here instead of the network, so it works the same in the browser and inside Tauri
 * (where a service worker is not available). Data lives in memory and resets on reload;
 * only the login/onboarding flags persist, like a cookie would.
 */

const SESSION_KEY = 'agent.mock.session';
const backend = new MockBackend();
const db = backend.db;

try {
  Object.assign(db.session, JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}'));
} catch {
  /* private mode / blocked storage: start logged out */
}
const saveSession = () => {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(db.session));
  } catch {
    /* ignore */
  }
};

setInterval(() => backend.tick(), 2600);
setInterval(() => backend.heartbeat(), 3000);

type Body = Record<string, unknown> | undefined;
interface Ctx {
  params: Record<string, string>;
  body: Body;
  query: URLSearchParams;
}
type Handler = (ctx: Ctx) => unknown;

const routes: [method: string, pattern: string, handler: Handler][] = [];
const on = (method: string, pattern: string, handler: Handler) =>
  routes.push([method, pattern, handler]);
const body = <T>(ctx: Ctx) => (ctx.body ?? {}) as T;

const session = (): Session => {
  const user = db.members.find((m) => m.id === db.meId)!;
  return { user, workspace: db.workspace, onboarded: db.session.onboarded };
};
const requireAuth = () => {
  if (!db.session.loggedIn) throw new HttpError(401, 'Not logged in');
};

// ----- auth & onboarding -----
on('GET', '/session', () => {
  requireAuth();
  return session();
});
on('POST', '/auth/login', (ctx) => {
  const { email } = body<LoginInput>(ctx);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Email không hợp lệ');
  db.session.loggedIn = true;
  saveSession();
  return session();
});
on('POST', '/auth/logout', () => {
  db.session.loggedIn = false;
  db.session.onboarded = false;
  saveSession();
  return null;
});
on('GET', '/onboarding/cli-status', () => {
  db.cliPolledAt ??= backend.now();
  const connected = backend.now() - db.cliPolledAt > 2600;
  return { connected, computerId: connected ? 'c1' : null };
});
on('POST', '/onboarding/complete', () => {
  db.session.onboarded = true;
  db.cliPolledAt = null;
  saveSession();
  return session();
});

// ----- people & machines -----
on('GET', '/members', () => db.members);
on('GET', '/computers', () => db.computers);
on('GET', '/agents', () => db.agents);
on('GET', '/agents/:id', ({ params }) => {
  const a = backend.agent(params.id);
  if (!a) throw new HttpError(404, 'Agent not found');
  return a;
});
on('PATCH', '/agents/:id', (ctx) => {
  const a = backend.agent(ctx.params.id);
  if (!a) throw new HttpError(404, 'Agent not found');
  const patch = body<UpdateAgentInput>(ctx);
  if (patch.persona !== undefined) a.persona = patch.persona;
  for (const s of patch.skills ?? []) {
    const skill = a.skills.find((x) => x.id === s.id);
    if (skill) skill.enabled = s.enabled;
  }
  backend.emit({ type: 'agents.changed' });
  return a;
});
on('GET', '/agents/:id/activity', ({ params }) => db.agentActivity[params.id] ?? []);
on('POST', '/agents/:id/dm', ({ params }) => ensureDm(backend, params.id));

// ----- chat -----
on('GET', '/rooms', () => listRooms(backend));
on('GET', '/chats/:id', ({ params }) => findChat(backend, params.id));
on('GET', '/chats/:id/messages', ({ params }) => {
  findChat(backend, params.id);
  return db.messages[params.id] ?? [];
});
on('POST', '/chats/:id/messages', (ctx) =>
  sendMessage(backend, ctx.params.id, body<SendMessageInput>(ctx)),
);
on('POST', '/chats/:id/read', ({ params }) => {
  markRead(backend, params.id);
  return null;
});
on('POST', '/messages/:id/send-draft', ({ params }) => sendDraft(backend, params.id));

// ----- tasks -----
on('GET', '/tasks', () => [...db.tasks].sort((a, b) => a.rank - b.rank));
on('POST', '/tasks', (ctx) => backend.createTask(body<CreateTaskInput>(ctx)));
on('PATCH', '/tasks/:id', (ctx) => {
  const t = backend.task(ctx.params.id);
  backend.updateTask(t, body<UpdateTaskInput>(ctx));
  return t;
});
on('POST', '/tasks/:id/move', (ctx) => {
  const t = backend.task(ctx.params.id);
  const { status, beforeId } = body<MoveTaskInput>(ctx);
  if (beforeId !== undefined) backend.rerank(t, beforeId);
  backend.moveTask(t, status);
  backend.changed();
  return t;
});
const taskAction = (path: string, fn: (id: string, ctx: Ctx) => void) =>
  on('POST', `/tasks/:id/${path}`, (ctx) => {
    fn(ctx.params.id, ctx);
    return backend.task(ctx.params.id);
  });
taskAction('approve', (id) => backend.approveTask(backend.task(id)));
taskAction('revise', (id, ctx) =>
  backend.reviseTask(backend.task(id), body<{ note?: string }>(ctx).note),
);
taskAction('stop', (id) => backend.stopTask(backend.task(id)));
taskAction('retry', (id) => backend.retryTask(backend.task(id)));
taskAction('run-now', (id) => backend.runNow(backend.task(id)));
taskAction('comments', (id, ctx) =>
  backend.comment(backend.task(id), body<CommentInput>(ctx).markdown ?? ''),
);
on('GET', '/run-spans', ({ query }) => {
  const since = Date.parse(query.get('since') ?? '') || 0;
  return db.spans.filter((s) => Date.parse(s.endedAt) > since);
});
on('GET', '/scheduler', () => db.scheduler);
on('PUT', '/scheduler', (ctx) => {
  backend.setPaused(!!body<SchedulerState>(ctx).paused);
  return db.scheduler;
});

// ----- dashboard -----
on('GET', '/dashboard', () => db.dashboard);
on('POST', '/dashboard/attention/:id/resolve', ({ params }) => {
  const item = db.dashboard.attention.find((x) => x.id === params.id);
  if (!item) throw new HttpError(404, 'Not found');
  if (item.taskId) {
    const t = backend.task(item.taskId);
    t.error = null;
    backend.moveTask(t, 'doing');
    backend.changed();
  }
  item.resolved = true;
  backend.emit({ type: 'dashboard.changed' });
  return item;
});

// ----- connections -----
on('GET', '/connections', () => db.connections);
on(
  'POST',
  '/connections/:id/authorize',
  () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 1500)),
);
on('POST', '/connections/:id/connect', (ctx) =>
  connect(backend, ctx.params.id, body<ConnectInput>(ctx)),
);
on('DELETE', '/connections/:id', ({ params }) => disconnect(backend, params.id));

// ----- transport -----
function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const s = path.split('/');
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Drop-in for `fetch` that answers from the mock backend with the API envelope. */
export async function mockFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const { pathname, searchParams } = new URL(url, 'http://mock.local');
  const path = pathname.replace(/^.*\/api\/v\d+/, '') || '/';
  const method = (init.method ?? 'GET').toUpperCase();
  await new Promise((r) => setTimeout(r, 30 + Math.random() * 60));
  try {
    for (const [m, pattern, handler] of routes) {
      if (m !== method) continue;
      const params = match(pattern, path);
      if (!params) continue;
      if (!pattern.startsWith('/auth') && pattern !== '/session') requireAuth();
      const parsed =
        typeof init.body === 'string' && init.body ? (JSON.parse(init.body) as Body) : undefined;
      const data = await handler({ params, body: parsed, query: searchParams });
      return json(200, { success: true, data: structuredClone(data ?? null), message: 'OK' });
    }
    throw new HttpError(404, `No mock route for ${method} ${path}`);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Mock error';
    return json(status, {
      success: false,
      data: null,
      message,
      meta: { statusCode: status, path, timestamp: new Date().toISOString() },
    });
  }
}

export const mockRealtime = {
  subscribe(handler: (event: RealtimeEvent) => void) {
    return backend.subscribe((event) => handler(structuredClone(event)));
  },
};
