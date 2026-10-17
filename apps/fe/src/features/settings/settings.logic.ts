import type { AuditEvent, MemberRole } from '@repo/shared';
import type { MessageKey } from '../../i18n';

export interface ParsedUserAgent {
  browser: string | null;
  os: string | null;
}

/** Small, dependency-free user agent reader: enough to say "Chrome on macOS". */
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  if (!ua) return { browser: null, os: null };
  let os: string | null = null;
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux|X11/i.test(ua)) os = 'Linux';

  let browser: string | null = null;
  if (/Tauri|\bAgent\/\d/i.test(ua)) browser = 'Agent Desktop';
  else if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari';
  else if (/AppleWebKit/.test(ua)) browser = os === 'macOS' ? 'Safari' : 'WebKit';
  else if (/^node|undici|axios|curl|okhttp/i.test(ua)) browser = ua.split(/[\s/]/)[0];
  return { browser, os };
}

/** "Chrome · macOS", or whichever half is known; `null` when nothing is. */
export function deviceLabel(ua: string | null | undefined): string | null {
  const { browser, os } = parseUserAgent(ua);
  const parts = [browser, os].filter((p): p is string => !!p);
  return parts.length ? parts.join(' · ') : null;
}

/** Audit actions the API emits today, mapped to their message keys. Unknown ones show raw. */
export const AUDIT_ACTION_KEYS = {
  'auth.login': 'settings.audit.actions.authLogin',
  'auth.login_failed': 'settings.audit.actions.authLoginFailed',
  'auth.locked': 'settings.audit.actions.authLocked',
  'auth.password_reset': 'settings.audit.actions.authPasswordReset',
  'account.password_changed': 'settings.audit.actions.accountPasswordChanged',
  'account.profile_updated': 'settings.audit.actions.accountProfileUpdated',
  'account.sessions_revoked': 'settings.audit.actions.accountSessionsRevoked',
  'account.deleted': 'settings.audit.actions.accountDeleted',
  'agent.created': 'settings.audit.actions.agentCreated',
  'agent.updated': 'settings.audit.actions.agentUpdated',
  'agent.deleted': 'settings.audit.actions.agentDeleted',
  'computer.paired': 'settings.audit.actions.computerPaired',
  'computer.revoked': 'settings.audit.actions.computerRevoked',
  'connection.connected': 'settings.audit.actions.connectionConnected',
  'connection.disconnected': 'settings.audit.actions.connectionDisconnected',
  'scheduler.updated': 'settings.audit.actions.schedulerUpdated',
  'invite.created': 'settings.audit.actions.inviteCreated',
  'invite.revoked': 'settings.audit.actions.inviteRevoked',
  'invite.accepted': 'settings.audit.actions.inviteAccepted',
  'member.role_changed': 'settings.audit.actions.memberRoleChanged',
  'member.removed': 'settings.audit.actions.memberRemoved',
  'workspace.renamed': 'settings.audit.actions.workspaceRenamed',
  'workspace.ownership_transferred': 'settings.audit.actions.workspaceOwnershipTransferred',
  'billing.plan_changed': 'settings.audit.actions.billingPlanChanged',
} as const satisfies Record<string, MessageKey>;

type Translate = (key: MessageKey) => string;

/** Human label of an audit action; falls back to the raw action name. */
export function auditActionLabel(action: string, t: Translate): string {
  const key = (AUDIT_ACTION_KEYS as Record<string, MessageKey | undefined>)[action];
  return key ? t(key) : action;
}

/** Best short description of what an event touched: a name/email in meta, else a short id. */
export function auditTarget(event: Pick<AuditEvent, 'targetType' | 'targetId' | 'meta'>): string {
  const meta = event.meta ?? {};
  const named = [meta.name, meta.email, meta.title].find(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  if (named) return named;
  if (event.targetId) {
    const id = event.targetId.length > 8 ? `${event.targetId.slice(0, 8)}…` : event.targetId;
    return event.targetType ? `${event.targetType} ${id}` : id;
  }
  return event.targetType ?? '';
}

/** Settings sections, in nav order. `roles` omitted = everyone. */
export type SettingsGroup = 'account' | 'workspace' | 'app';
export interface SettingsSectionDef {
  id: string;
  group: SettingsGroup;
  roles?: readonly MemberRole[];
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  { id: 'profile', group: 'account' },
  { id: 'security', group: 'account' },
  { id: 'appearance', group: 'account' },
  { id: 'workspace', group: 'workspace', roles: ['owner', 'admin'] },
  { id: 'members', group: 'workspace' },
  { id: 'billing', group: 'workspace', roles: ['owner', 'admin'] },
  { id: 'audit', group: 'workspace', roles: ['owner', 'admin'] },
  { id: 'desktop', group: 'app' },
];

export const sectionsFor = (role: MemberRole | undefined): SettingsSectionDef[] =>
  SETTINGS_SECTIONS.filter((s) => !s.roles || (role !== undefined && s.roles.includes(role)));

/** Avatar colors (match the seeded members); `null` is the default avatar color. */
export const PROFILE_COLORS = [
  '#5157b0',
  '#b0516f',
  '#3d8a6a',
  '#d97757',
  '#1f6f7a',
  '#7a5a1f',
  '#8a5db0',
  '#6b7046',
] as const;

export interface ProfileDraft {
  name: string;
  color: string | null;
}

/** Fields that differ from the saved profile (only these are sent), or null when nothing changed. */
export function profilePatch(
  saved: { name: string; color: string | null },
  draft: ProfileDraft,
): { name?: string; color?: string | null } | null {
  const patch: { name?: string; color?: string | null } = {};
  const name = draft.name.trim();
  if (name !== saved.name) patch.name = name;
  if (draft.color !== saved.color) patch.color = draft.color;
  return Object.keys(patch).length ? patch : null;
}

export const isProfileNameValid = (name: string): boolean => {
  const n = name.trim();
  return n.length >= 1 && n.length <= 60;
};

/** Only the owner hands out the admin role (invite or role change). */
export const canInviteAdmin = (role: MemberRole | undefined): boolean => role === 'owner';

/** Owner and admin can invite; the role they may grant is limited by `canInviteAdmin`. */
export const canInvite = (role: MemberRole | undefined): boolean =>
  role === 'owner' || role === 'admin';

interface Actor {
  id: string;
  role: MemberRole | undefined;
}

/** Only the owner changes roles, never their own and never the owner row. */
export function canChangeRole(actor: Actor, target: { id: string; role: MemberRole }): boolean {
  return actor.role === 'owner' && target.id !== actor.id && target.role !== 'owner';
}

/** Owner removes anyone but themselves; admin removes plain members only. */
export function canRemove(actor: Actor, target: { id: string; role: MemberRole }): boolean {
  if (target.id === actor.id || target.role === 'owner') return false;
  if (actor.role === 'owner') return true;
  return actor.role === 'admin' && target.role === 'member';
}

/** Ownership can only move to another existing member. */
export const transferCandidates = <T extends { id: string; role: MemberRole }>(
  actor: Actor,
  members: readonly T[],
): T[] => (actor.role === 'owner' ? members.filter((m) => m.id !== actor.id) : []);

/** Link an invitee opens (hash routing, like the emailed one). */
export const buildInviteLink = (origin: string, token: string): string =>
  `${origin.replace(/\/+$/, '')}/#/invite?token=${encodeURIComponent(token)}`;

/** The API's link when it sent one, else one built from this app's own origin. */
export const inviteLinkOf = (result: { token: string; url?: string | null }, origin: string) =>
  result.url?.trim() || buildInviteLink(origin, result.token);

/** The workspace can only be deleted after typing its exact name (surrounding space is ignored). */
export const confirmNameMatches = (typed: string, workspaceName: string): boolean =>
  typed.trim().length > 0 && typed.trim() === workspaceName.trim();

export const isWorkspaceNameValid = (name: string): boolean => {
  const n = name.trim();
  return n.length >= 1 && n.length <= 80;
};
