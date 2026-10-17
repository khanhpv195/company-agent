import type { AuditEvent, AuthSessionInfo, Member } from '@repo/shared';
import { isStrongPassword } from '@repo/shared';
import { HttpError } from './backend';

/** In-memory account state for the mock API (resets on reload, like the rest of the mock). */
export const account = {
  emailVerified: true,
  lastResendAt: 0,
  sessions: [] as AuthSessionInfo[],
};

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export function seedAccount(): void {
  account.sessions = [
    {
      id: 's-current',
      createdAt: ago(60 * 24),
      lastUsedAt: ago(0),
      userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
      ip: '127.0.0.1',
      current: true,
    },
    {
      id: 's-phone',
      createdAt: ago(60 * 24 * 5),
      lastUsedAt: ago(95),
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Safari/604.1',
      ip: '203.0.113.24',
      current: false,
    },
    {
      id: 's-win',
      createdAt: ago(60 * 24 * 9),
      lastUsedAt: ago(60 * 30),
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      ip: '198.51.100.7',
      current: false,
    },
  ];
}
seedAccount();

export function updateProfile(me: Member, input: { name?: unknown; color?: unknown }): void {
  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 60) throw new HttpError(400, 'Tên cần từ 1 đến 60 ký tự');
    me.name = name;
  }
  if (input.color !== undefined) {
    if (
      input.color !== null &&
      !(typeof input.color === 'string' && /^#[0-9a-f]{6}$/i.test(input.color))
    )
      throw new HttpError(400, 'Màu không hợp lệ');
    me.color = input.color as string | null;
  }
}

export function changePassword(
  me: Member,
  input: { currentPassword?: string; newPassword?: string },
) {
  if (!input.currentPassword || input.currentPassword === 'wrong')
    throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
  if (!isStrongPassword(input.newPassword ?? '', me.email))
    throw new HttpError(400, 'Mật khẩu mới chưa đạt yêu cầu');
  account.sessions = account.sessions.filter((s) => s.current);
}

export function resendVerification(now: number): void {
  if (account.emailVerified) return;
  if (now - account.lastResendAt < 60_000)
    throw new HttpError(429, 'Vừa gửi email xác minh, vui lòng đợi một phút');
  account.lastResendAt = now;
}

export function verifyEmail(token: string | undefined): void {
  if (!token || token === 'bad') throw new HttpError(400, 'Mã không hợp lệ hoặc đã hết hạn');
  account.emailVerified = true;
}

export function resetPassword(input: { token?: string; newPassword?: string }): void {
  if (!input.token || input.token === 'bad')
    throw new HttpError(400, 'Mã không hợp lệ hoặc đã hết hạn');
  if (!isStrongPassword(input.newPassword ?? ''))
    throw new HttpError(400, 'Mật khẩu mới chưa đạt yêu cầu');
}

const ACTIONS: [string, string | null, string | null, Record<string, unknown>][] = [
  ['auth.login', null, null, {}],
  ['agent.created', 'agent', 'a1b2c3d4-0000', { name: 'Reviewer' }],
  ['computer.paired', 'computer', 'c1d2e3f4-1111', { name: 'MacBook Pro' }],
  ['account.profile_updated', null, null, {}],
  ['connection.connected', 'connection', 'zalo', {}],
  ['scheduler.updated', null, null, { paused: false }],
  ['auth.login_failed', null, null, {}],
  ['agent.updated', 'agent', 'a1b2c3d4-0000', { name: 'Reviewer' }],
  ['members.role_changed', 'member', 'u2', { name: 'Hằng' }],
];

const AUDIT: AuditEvent[] = Array.from({ length: 120 }, (_, i) => {
  const [action, targetType, targetId, meta] = ACTIONS[i % ACTIONS.length];
  return {
    id: `ev-${String(i).padStart(3, '0')}`,
    at: ago(i * 37 + 3),
    actor: i % 7 === 6 ? null : { id: 'u1', name: 'khanhpv' },
    action,
    targetType,
    targetId,
    meta,
    ip: i % 7 === 6 ? null : '127.0.0.1',
  };
});

/** Newest first; the cursor is just the index of the next event. */
export function auditPage(before: string | null, limit: number) {
  const start = before ? Number(before) || 0 : 0;
  const items = AUDIT.slice(start, start + limit);
  const next = start + limit < AUDIT.length ? String(start + limit) : null;
  return { items, meta: { limit, nextCursor: next } };
}

/** A handler result that carries response `meta` next to `data`. */
export class WithMeta {
  constructor(
    readonly items: unknown,
    readonly meta: Record<string, unknown>,
  ) {}
}
