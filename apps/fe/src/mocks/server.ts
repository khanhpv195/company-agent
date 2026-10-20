import type {
  AuthResult,
  BillingSummary,
  CommentInput,
  ConnectInput,
  CreateAgentInput,
  AddRoomMembersInput,
  CreatePinInput,
  CreateRoomInput,
  CreateTaskInput,
  LoginInput,
  RegisterInput,
  MoveTaskInput,
  RealtimeEvent,
  PostRoomMessageInput,
  SchedulerState,
  ThreadFilter,
  Session,
  UpdateAgentInput,
  UpdateRoomInput,
  UpdateTaskInput,
} from '@repo/shared';
import { isStrongPassword, planById, type WorkspacePlan } from '@repo/shared';
import { HttpError, MockBackend } from './backend';
import {
  account,
  auditPage,
  changePassword,
  resendVerification,
  resetPassword,
  updateProfile,
  verifyEmail,
  WithMeta,
} from './account';
import {
  assertDepartmentId,
  cleanTitle,
  createDepartment,
  deleteDepartment,
  joinDepartmentRoom,
  liveDepartments,
  reorderDepartments,
  updateDepartment,
} from './departments';
import { createInvite, previewInvite, revokeInvite, seedTeam, takeInvite, team } from './team';
import {
  createSkill,
  deleteSkill,
  getSkill,
  listSkills,
  restoreSkill,
  setAgentSkills,
  skillVersions,
  updateSkill,
} from './skills';
import {
  addRoomMembers,
  browseRooms,
  connect,
  createPin,
  createRoom,
  deleteMessage,
  deletePin,
  deleteRoom,
  disconnect,
  editMessage,
  editThreadTitle,
  ensureDm,
  joinRoom,
  leaveRoom,
  listPins,
  listRooms,
  markRead,
  markUnread,
  mentionsFeed,
  presence,
  react,
  readAll,
  removeRoomMember,
  resolveChat,
  roomMembers,
  roomThreads,
  sendDraft,
  sendRoomMessage,
  setMuted,
  stopMessage,
  threadPage,
  timeline,
  updateRoom,
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
  return {
    user: { ...user, emailVerified: account.emailVerified },
    workspace: db.workspace,
    onboarded: db.session.onboarded,
  };
};
const authResult = (): AuthResult => ({
  session: session(),
  accessToken: 'mock-access',
  refreshToken: 'mock-refresh',
});
const requireAuth = () => {
  if (!db.session.loggedIn) throw new HttpError(401, 'Not logged in');
};

// ----- auth & onboarding -----
on('GET', '/session', () => {
  requireAuth();
  return session();
});
on('POST', '/auth/login', (ctx) => {
  const { email, password } = body<LoginInput>(ctx);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Email không hợp lệ');
  if (!password) throw new HttpError(400, 'Vui lòng nhập mật khẩu');
  db.session.loggedIn = true;
  saveSession();
  return authResult();
});
on('POST', '/auth/register', (ctx) => {
  const { name, email, password, workspaceName, acceptTerms } = body<RegisterInput>(ctx);
  if (!name?.trim()) throw new HttpError(400, 'Vui lòng nhập tên');
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Email không hợp lệ');
  if (!isStrongPassword(password ?? '', email))
    throw new HttpError(400, 'Mật khẩu cần 8-128 ký tự, gồm chữ và số');
  if (acceptTerms !== true) throw new HttpError(400, 'Bạn cần đồng ý với điều khoản');
  const me = db.members.find((m) => m.id === db.meId)!;
  me.name = name.trim();
  me.email = email;
  if (workspaceName?.trim()) db.workspace.name = workspaceName.trim();
  account.emailVerified = false;
  db.session.loggedIn = true;
  db.session.onboarded = false;
  saveSession();
  return authResult();
});
// Like the real API: always success, so the response never reveals whether an email has an account.
on('POST', '/auth/forgot-password', () => null);
on('POST', '/auth/reset-password', (ctx) => {
  resetPassword(body<{ token?: string; newPassword?: string }>(ctx));
  return null;
});
on('POST', '/auth/verify-email', (ctx) => {
  verifyEmail(body<{ token?: string }>(ctx).token);
  return null;
});
on('POST', '/auth/refresh', () => {
  requireAuth();
  return authResult();
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

// ----- account -----
const me = () => db.members.find((m) => m.id === db.meId)!;
on('PATCH', '/me', (ctx) => {
  updateProfile(me(), body<{ name?: unknown; color?: unknown; title?: unknown }>(ctx));
  backend.emit({ type: 'members.changed' });
  return session();
});
on('POST', '/me/password', (ctx) => {
  changePassword(me(), body<{ currentPassword?: string; newPassword?: string }>(ctx));
  return null;
});
on('GET', '/me/sessions', () => account.sessions);
on('POST', '/me/sessions/revoke-others', () => {
  account.sessions = account.sessions.filter((s) => s.current);
  return null;
});
on('DELETE', '/me/sessions/:id', ({ params }) => {
  const target = account.sessions.find((s) => s.id === params.id);
  if (!target) throw new HttpError(404, 'Session not found');
  account.sessions = account.sessions.filter((s) => s !== target);
  return null;
});
on('POST', '/me/verify-email/resend', () => {
  resendVerification(backend.now());
  return null;
});
on('DELETE', '/me', (ctx) => {
  if (!body<{ password?: string }>(ctx).password)
    throw new HttpError(400, 'Vui lòng nhập mật khẩu');
  if (me().role === 'owner')
    throw new HttpError(409, 'Hãy chuyển quyền sở hữu workspace trước khi xoá tài khoản');
  db.session.loggedIn = false;
  saveSession();
  return null;
});
on('GET', '/audit-events', ({ query }) => {
  requireManager();
  const page = auditPage(query.get('before'), Number(query.get('limit')) || 50);
  return new WithMeta(page.items, page.meta);
});

// ----- billing -----
const plan = (id: WorkspacePlan) => planById(id);
/** Mirrors the real default (`BILLING_LIMITS_ENABLED=false`): no limits, no plan UI. */
const mockBilling = { plan: 'pro' as WorkspacePlan, limitsEnabled: false };
const requireOwner = () => {
  if (me().role !== 'owner') throw new HttpError(403, 'Chỉ chủ sở hữu mới quản lý được gói');
};
on('GET', '/billing', (): BillingSummary => {
  const now = new Date(backend.now());
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const byDay = Array.from({ length: now.getDate() }, (_, i) => {
    const runs = (i * 7) % 6;
    return {
      date: new Date(start.getFullYear(), start.getMonth(), i + 1).toISOString().slice(0, 10),
      runs,
      costUsd: Math.round(runs * 0.37 * 100) / 100,
    };
  });
  const byAgent = db.agents.map((a, i) => ({
    agentId: a.id,
    name: a.name,
    runs: 12 - i * 4,
    costUsd: Math.round((12 - i * 4) * 0.41 * 100) / 100,
  }));
  const p = plan(mockBilling.plan);
  return {
    plan: p.id,
    limits: { seats: p.seats, agents: p.agents, computers: p.computers },
    usage: {
      seats: db.members.length + team.invites.length,
      agents: db.agents.filter((a) => !a.simulated).length,
      computers: db.computers.filter((c) => !c.simulated && !c.revokedAt).length,
    },
    period: { start: start.toISOString(), end: end.toISOString() },
    costUsd: Math.round(byDay.reduce((s, d) => s + d.costUsd, 0) * 100) / 100,
    runs: byDay.reduce((s, d) => s + d.runs, 0),
    byAgent,
    byDay,
    subscription:
      p.id === 'free'
        ? null
        : {
            status: 'active',
            currentPeriodEnd: end.toISOString(),
            cancelAtPeriodEnd: false,
          },
    checkoutAvailable: true,
    limitsEnabled: mockBilling.limitsEnabled,
  };
});
on('POST', '/billing/checkout', () => {
  requireOwner();
  return { url: `${window.location.origin}/#/settings/billing?checkout=success` };
});
on('POST', '/billing/portal', () => {
  requireOwner();
  return { url: `${window.location.origin}/#/settings/billing` };
});

// ----- team & workspace -----
seedTeam(Date.now());
const PALETTE = ['#5157b0', '#3d8a6a', '#d97757', '#8a5db0'];
const checkPassword = (password: string | undefined) => {
  if (!password) throw new HttpError(400, 'Vui lòng nhập mật khẩu');
  if (password === 'wrong') throw new HttpError(400, 'Mật khẩu không đúng');
};
const memberOr404 = (id: string) => {
  const m = db.members.find((x) => x.id === id);
  if (!m) throw new HttpError(404, 'Không tìm thấy thành viên');
  return m;
};
on('GET', '/invites', () => {
  requireManager();
  return team.invites.map((i) => i.invite);
});
on('POST', '/invites', (ctx) => {
  requireManager();
  const invite = createInvite(backend.now(), me().name, body(ctx), me().role, (id) =>
    assertDepartmentId(backend, id),
  );
  if (db.members.some((m) => m.email.toLowerCase() === invite.invite.email))
    throw new HttpError(409, 'Email này đã có tài khoản');
  return invite;
});
on('DELETE', '/invites/:id', ({ params }) => {
  requireManager();
  revokeInvite(params.id);
  return null;
});
on('GET', '/invites/preview', ({ query }) => previewInvite(query.get('token'), db.workspace.name));
on('POST', '/invites/accept', (ctx) => {
  const { token, name, password, acceptTerms } = body<{
    token?: string;
    name?: string;
    password?: string;
    acceptTerms?: boolean;
  }>(ctx);
  const invite = previewInvite(token ?? null, db.workspace.name);
  if (db.members.some((m) => m.email.toLowerCase() === invite.email.toLowerCase()))
    throw new HttpError(409, 'An account with this email already exists');
  if (!name?.trim()) throw new HttpError(400, 'Vui lòng nhập tên');
  if (!isStrongPassword(password ?? '', invite.email))
    throw new HttpError(400, 'Mật khẩu cần 8-128 ký tự, gồm chữ và số');
  if (acceptTerms !== true) throw new HttpError(400, 'Bạn cần đồng ý với điều khoản');
  const accepted = takeInvite(token);
  const departmentId = db.departments.some((d) => d.id === accepted.departmentId)
    ? accepted.departmentId
    : null;
  const member = {
    id: `u${db.members.length + 1}-${Math.floor(backend.now() % 10000)}`,
    name: name.trim(),
    email: invite.email,
    role: invite.role,
    color: PALETTE[db.members.length % PALETTE.length],
    departmentId,
    title: accepted.title,
  };
  db.members.push(member);
  joinDepartmentRoom(backend, departmentId, 'member', member.id);
  db.meId = member.id;
  db.session.loggedIn = true;
  db.session.onboarded = true;
  saveSession();
  account.emailVerified = true;
  backend.emit({ type: 'members.changed' });
  return authResult();
});
on('PATCH', '/members/:id', ({ params, body: raw }) => {
  if (me().role !== 'owner') throw new HttpError(403, 'Chỉ chủ sở hữu mới đổi được vai trò');
  const target = memberOr404(params.id);
  const role = (raw as { role?: string } | undefined)?.role;
  if (role !== 'admin' && role !== 'member') throw new HttpError(400, 'Vai trò không hợp lệ');
  if (target.id === me().id || target.role === 'owner')
    throw new HttpError(403, 'Không thể đổi vai trò của chủ sở hữu');
  target.role = role;
  backend.emit({ type: 'members.changed' });
  return target;
});
on('PUT', '/members/:id/department', ({ params, body: raw }) => {
  requireManager();
  const target = memberOr404(params.id);
  target.departmentId = assertDepartmentId(
    backend,
    (raw as { departmentId?: unknown } | undefined)?.departmentId,
  );
  joinDepartmentRoom(backend, target.departmentId, 'member', target.id);
  backend.emit({ type: 'departments.changed' });
  return target;
});
on('PUT', '/members/:id/title', ({ params, body: raw }) => {
  requireManager();
  const target = memberOr404(params.id);
  target.title = cleanTitle((raw as { title?: unknown } | undefined)?.title);
  backend.emit({ type: 'members.changed' });
  return target;
});
on('DELETE', '/members/:id', ({ params }) => {
  requireManager();
  const target = memberOr404(params.id);
  if (target.id === me().id || target.role === 'owner')
    throw new HttpError(403, 'Không thể xoá chủ sở hữu hoặc chính bạn');
  if (me().role === 'admin' && target.role !== 'member')
    throw new HttpError(403, 'Quản trị viên chỉ xoá được thành viên');
  db.members = db.members.filter((m) => m !== target);
  backend.emit({ type: 'members.changed' });
  return null;
});
on('POST', '/workspace/transfer-ownership', (ctx) => {
  if (me().role !== 'owner') throw new HttpError(403, 'Chỉ chủ sở hữu mới chuyển được quyền');
  const { memberId, password } = body<{ memberId?: string; password?: string }>(ctx);
  checkPassword(password);
  const target = memberOr404(memberId ?? '');
  if (target.id === me().id) throw new HttpError(400, 'Hãy chọn người khác');
  target.role = 'owner';
  me().role = 'admin';
  backend.emit({ type: 'members.changed' });
  backend.emit({ type: 'workspace.changed' });
  return null;
});
on('PATCH', '/workspace', (ctx) => {
  requireManager();
  const name = body<{ name?: string }>(ctx).name?.trim() ?? '';
  if (!name || name.length > 80) throw new HttpError(400, 'Tên workspace cần từ 1 đến 80 ký tự');
  db.workspace.name = name;
  backend.emit({ type: 'workspace.changed' });
  return db.workspace;
});
on('DELETE', '/workspace', (ctx) => {
  if (me().role !== 'owner') throw new HttpError(403, 'Chỉ chủ sở hữu mới xoá được workspace');
  const { password, confirmName } = body<{ password?: string; confirmName?: string }>(ctx);
  checkPassword(password);
  if (confirmName !== db.workspace.name) throw new HttpError(400, 'Tên workspace không khớp');
  db.session.loggedIn = false;
  db.session.onboarded = false;
  saveSession();
  return null;
});

// ----- people & machines -----
on('GET', '/members', () => db.members);
on('GET', '/computers', () => db.computers);

const requireManager = () => {
  const role = db.members.find((m) => m.id === db.meId)?.role;
  if (role !== 'owner' && role !== 'admin')
    throw new HttpError(403, 'Bạn không có quyền thực hiện thao tác này');
};
const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const pairingChunk = () =>
  Array.from(
    { length: 4 },
    () => PAIR_ALPHABET[Math.floor(backend.random() * PAIR_ALPHABET.length)],
  ).join('');
on('POST', '/computers/pairing-codes', () => {
  requireManager();
  return {
    code: `${pairingChunk()}-${pairingChunk()}`,
    expiresAt: new Date(backend.now() + 10 * 60_000).toISOString(),
  };
});
on('DELETE', '/computers/:id', ({ params, query }) => {
  requireManager();
  const index = db.computers.findIndex((c) => c.id === params.id);
  if (index < 0) throw new HttpError(404, 'Computer not found');
  const computer = db.computers[index]!;
  const attached = db.agents.filter((a) => a.computerId === params.id);
  const targetId = query.get('moveAgentsTo');
  if (targetId) {
    const target = db.computers.find(
      (c) => c.id === targetId && c.id !== params.id && !c.revokedAt,
    );
    if (!target) throw new HttpError(400, 'Máy đích không hợp lệ để chuyển agent');
    for (const a of attached) {
      a.computerId = target.id;
      a.simulated = target.simulated;
    }
  } else if (attached.length && computer.simulated) {
    for (const a of attached) backend.deleteAgent(a.id);
  } else if (attached.length) {
    // The mock keeps agents pointing at real computers; the API revokes instead (see B1).
    throw new HttpError(409, 'Máy còn agent. Chuyển hoặc xoá agent trước khi gỡ máy.');
  }
  db.computers.splice(index, 1);
  backend.emit({ type: 'computers.changed' });
  backend.emit({ type: 'agents.changed' });
  backend.emit({ type: 'rooms.changed' });
  return null;
});
on('GET', '/departments', () => liveDepartments(backend));
on('POST', '/departments', (ctx) => {
  requireManager();
  return createDepartment(backend, body(ctx));
});
// Declared before `/departments/:id`, like the API, so "order" is not taken as an id.
on('PUT', '/departments/order', (ctx) => {
  requireManager();
  return reorderDepartments(backend, body<{ ids?: unknown }>(ctx).ids);
});
on('PATCH', '/departments/:id', (ctx) => {
  requireManager();
  return updateDepartment(backend, ctx.params.id, body(ctx));
});
on('DELETE', '/departments/:id', ({ params }) => {
  requireManager();
  deleteDepartment(backend, params.id);
  return null;
});
on('PUT', '/agents/:id/department', ({ params, body: raw }) => {
  requireManager();
  const a = backend.agent(params.id);
  if (!a) throw new HttpError(404, 'Agent not found');
  backend.updateAgent(a, {
    departmentId: ((raw as { departmentId?: string | null } | undefined)?.departmentId ?? null) as
      string | null,
  });
  return a;
});
on('GET', '/agents', () => db.agents);

// ----- skills -----
on('GET', '/skills', () => listSkills(backend));
on('POST', '/skills', (ctx) => createSkill(backend, body(ctx)));
on('GET', '/skills/:id', ({ params }) => getSkill(backend, params.id));
on('GET', '/skills/:id/versions', ({ params }) => skillVersions(backend, params.id));
on('PATCH', '/skills/:id', (ctx) => updateSkill(backend, ctx.params.id, body(ctx)));
on('POST', '/skills/:id/restore', (ctx) =>
  restoreSkill(backend, ctx.params.id, body<{ version?: unknown }>(ctx).version),
);
on('DELETE', '/skills/:id', ({ params }) => {
  deleteSkill(backend, params.id);
  return null;
});
on('PUT', '/agents/:id/skills', (ctx) => {
  const agent = backend.agent(ctx.params.id);
  if (!agent) throw new HttpError(404, 'Agent not found');
  return setAgentSkills(backend, agent, body<{ skillIds?: unknown }>(ctx).skillIds);
});
on('POST', '/agents', (ctx) => backend.createAgent(body<CreateAgentInput>(ctx)));
on('GET', '/agents/:id', ({ params }) => {
  const a = backend.agent(params.id);
  if (!a) throw new HttpError(404, 'Agent not found');
  return a;
});
on('PATCH', '/agents/:id', (ctx) => {
  const a = backend.agent(ctx.params.id);
  if (!a) throw new HttpError(404, 'Agent not found');
  backend.updateAgent(a, body<UpdateAgentInput>(ctx));
  return a;
});
on('DELETE', '/agents/:id', ({ params }) => {
  backend.deleteAgent(params.id);
  return null;
});
on('GET', '/agents/:id/activity', ({ params }) => db.agentActivity[params.id] ?? []);
on('POST', '/agents/:id/dm', ({ params }) => ensureDm(backend, params.id));

// ----- chat -----
on('GET', '/rooms', () => listRooms(backend));
on('GET', '/rooms/browse', () => browseRooms(backend));
on('POST', '/rooms', (ctx) => createRoom(backend, body<CreateRoomInput>(ctx)));
on('PATCH', '/rooms/:id', (ctx) => updateRoom(backend, ctx.params.id, body<UpdateRoomInput>(ctx)));
on('DELETE', '/rooms/:id', ({ params }) => deleteRoom(backend, params.id));
on('POST', '/rooms/:id/join', ({ params }) => joinRoom(backend, params.id));
on('POST', '/rooms/:id/leave', ({ params }) => leaveRoom(backend, params.id));
on('POST', '/rooms/:id/members', (ctx) =>
  addRoomMembers(backend, ctx.params.id, body<AddRoomMembersInput>(ctx)),
);
on('DELETE', '/rooms/:id/members/:kind/:targetId', ({ params }) =>
  removeRoomMember(backend, params.id, params.kind, params.targetId),
);
on('POST', '/rooms/read-all', () => readAll(backend));
on('GET', '/rooms/:id/messages', ({ params, query }) =>
  timeline(
    backend,
    params.id,
    query.get('beforeSeq') ? Number(query.get('beforeSeq')) : undefined,
    Number(query.get('limit')) || 50,
  ),
);
on('POST', '/rooms/:id/messages', (ctx) =>
  sendRoomMessage(backend, ctx.params.id, body<PostRoomMessageInput>(ctx)),
);
on('GET', '/rooms/:id/messages/:rootId/thread', ({ params, query }) =>
  threadPage(
    backend,
    params.id,
    params.rootId,
    query.get('afterSeq') ? Number(query.get('afterSeq')) : undefined,
    Number(query.get('limit')) || 100,
  ),
);
on('PATCH', '/rooms/:id/messages/:messageId', (ctx) =>
  editMessage(
    backend,
    ctx.params.id,
    ctx.params.messageId,
    body<{ markdown: string }>(ctx).markdown ?? '',
  ),
);
on('DELETE', '/rooms/:id/messages/:messageId', ({ params }) =>
  deleteMessage(backend, params.id, params.messageId),
);
on('POST', '/rooms/:id/messages/:messageId/stop', ({ params }) =>
  stopMessage(backend, params.id, params.messageId),
);
on('PATCH', '/rooms/:id/messages/:rootId/thread', (ctx) =>
  editThreadTitle(
    backend,
    ctx.params.id,
    ctx.params.rootId,
    body<{ title: string }>(ctx).title ?? '',
  ),
);
on('PUT', '/rooms/:id/messages/:mid/reactions/:key', ({ params }) =>
  react(backend, params.id, params.mid, params.key, true),
);
on('DELETE', '/rooms/:id/messages/:mid/reactions/:key', ({ params }) =>
  react(backend, params.id, params.mid, params.key, false),
);
on('GET', '/rooms/:id/members', ({ params }) => roomMembers(backend, params.id));
on('GET', '/rooms/:id/threads', ({ params, query }) =>
  roomThreads(backend, params.id, (query.get('filter') as ThreadFilter | null) ?? 'all'),
);
on('POST', '/rooms/:id/read', (ctx) =>
  markRead(backend, ctx.params.id, null, Number(body<{ seq: number }>(ctx).seq) || 0),
);
on('POST', '/rooms/:id/unread', (ctx) =>
  markUnread(
    backend,
    ctx.params.id,
    null,
    Number(body<{ throughSeq: number }>(ctx).throughSeq) || 1,
  ),
);
on('POST', '/rooms/:id/threads/:rootId/unread', (ctx) =>
  markUnread(
    backend,
    ctx.params.id,
    ctx.params.rootId,
    Number(body<{ throughSeq: number }>(ctx).throughSeq) || 1,
  ),
);
on('POST', '/rooms/:id/threads/:rootId/read', (ctx) =>
  markRead(backend, ctx.params.id, ctx.params.rootId, Number(body<{ seq: number }>(ctx).seq) || 0),
);
on('POST', '/rooms/:id/mute', ({ params }) => setMuted(backend, params.id, null, true));
on('DELETE', '/rooms/:id/mute', ({ params }) => setMuted(backend, params.id, null, false));
on('POST', '/rooms/:id/threads/:rootId/mute', ({ params }) =>
  setMuted(backend, params.id, params.rootId, true),
);
on('DELETE', '/rooms/:id/threads/:rootId/mute', ({ params }) =>
  setMuted(backend, params.id, params.rootId, false),
);
on('POST', '/rooms/:id/typing', () => null);
on('GET', '/pins', () => listPins(backend));
on('POST', '/pins', (ctx) => {
  const { targetType, targetId } = body<CreatePinInput>(ctx);
  return createPin(backend, targetType, targetId);
});
on('DELETE', '/pins/:id', ({ params }) => deletePin(backend, params.id));
on('GET', '/mentions', ({ query }) =>
  mentionsFeed(
    backend,
    query.get('before') ? Number(query.get('before')) : undefined,
    Number(query.get('limit')) || 30,
  ),
);
on('GET', '/presence', () => presence(backend));
// Legacy chat route (a DM room id or a thread root id), still used by the dashboard quick box.
on('POST', '/chats/:id/messages', (ctx) => {
  const { roomId, parentId } = resolveChat(backend, ctx.params.id);
  return sendRoomMessage(backend, roomId, {
    ...body<PostRoomMessageInput>(ctx),
    parentId: parentId ?? undefined,
  });
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
      if (data instanceof WithMeta)
        return json(200, {
          success: true,
          data: structuredClone(data.items),
          message: 'OK',
          meta: data.meta,
        });
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
      meta: {
        statusCode: status,
        path,
        timestamp: new Date().toISOString(),
        ...(e instanceof HttpError && e.details ? { details: e.details } : null),
      },
    });
  }
}

export const mockRealtime = {
  subscribe(handler: (event: RealtimeEvent) => void) {
    return backend.subscribe((event) => handler(structuredClone(event)));
  },
};
