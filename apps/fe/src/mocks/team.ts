import type { AssignableRole, Invite, InvitePreview, Member } from '@repo/shared';
import { HttpError } from './backend';

const DAY = 86_400_000;

/** In-memory pending invites of the mock API (token -> invite). */
export const team = {
  invites: [] as { invite: Invite; token: string }[],
  seq: 0,
};

const iso = (ms: number) => new Date(ms).toISOString();

export function seedTeam(now: number): void {
  team.invites = [];
  team.seq = 0;
  createInvite(now, 'Khánh Linh', { email: 'linh@holatech.tech', role: 'member' });
}

export function createInvite(
  now: number,
  inviterName: string,
  input: { email?: unknown; role?: unknown },
  actorRole: Member['role'] = 'owner',
) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Email không hợp lệ');
  if (input.role !== 'admin' && input.role !== 'member')
    throw new HttpError(400, 'Vai trò không hợp lệ');
  if (input.role === 'admin' && actorRole !== 'owner')
    throw new HttpError(403, 'Chỉ chủ sở hữu mới mời được quản trị viên');
  team.invites = team.invites.filter((i) => i.invite.email !== email);
  const token = `mock-invite-${++team.seq}-${Math.floor(now % 100000)}`;
  const invite: Invite = {
    id: `inv-${team.seq}`,
    email,
    role: input.role as AssignableRole,
    departmentId: null,
    title: null,
    invitedByName: inviterName,
    createdAt: iso(now),
    expiresAt: iso(now + 7 * DAY),
  };
  team.invites.push({ invite, token });
  return { invite, token, url: `${location.origin}/#/invite?token=${encodeURIComponent(token)}` };
}

export function revokeInvite(id: string): void {
  const before = team.invites.length;
  team.invites = team.invites.filter((i) => i.invite.id !== id);
  if (team.invites.length === before) throw new HttpError(404, 'Không tìm thấy lời mời');
}

function find(token: string | null | undefined) {
  const found = team.invites.find((i) => i.token === token);
  if (!found) throw new HttpError(404, 'Lời mời không hợp lệ hoặc đã hết hạn');
  return found;
}

export function previewInvite(token: string | null, workspaceName: string): InvitePreview {
  const { invite } = find(token);
  return {
    workspaceName,
    email: invite.email,
    role: invite.role,
    invitedByName: invite.invitedByName,
    expiresAt: invite.expiresAt,
  };
}

/** Consumes the invite and returns the data for the new member. */
export function takeInvite(token: string | undefined) {
  const found = find(token);
  team.invites = team.invites.filter((i) => i !== found);
  return found.invite;
}
