export type MemberRole = 'owner' | 'admin' | 'member';

export interface Member {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  /** Avatar background; the UI falls back to the default avatar color. */
  color: string | null;
  departmentId: string | null;
  /** Job title, e.g. "Trưởng phòng Kinh doanh". */
  title: string | null;
}

export type WorkspacePlan = 'free' | 'pro' | 'team';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: WorkspacePlan;
}

/** The signed-in member as the session sees them (the people lists do not carry this flag). */
export interface SessionUser extends Member {
  emailVerified: boolean;
}

export interface Session {
  user: SessionUser;
  workspace: Workspace;
  onboarded: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  workspaceName?: string;
  /** Must be `true`; stored as `terms_accepted_at`. */
  acceptTerms: boolean;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

export interface VerifyEmailInput {
  token: string;
}

export interface UpdateProfileInput {
  /** 1..60 characters after trimming. */
  name?: string;
  /** `#rrggbb`, or `null` to go back to the default avatar color. */
  color?: string | null;
  /** Own job title: trimmed, at most 80 characters; empty or `null` clears it. */
  title?: string | null;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface DeleteAccountInput {
  password: string;
}

/** One live login (refresh-token family) of the caller. */
export interface AuthSessionInfo {
  /** The refresh family id; also the `sid` claim of the access tokens issued for it. */
  id: string;
  createdAt: string;
  lastUsedAt: string;
  userAgent: string | null;
  ip: string | null;
  /** True for the session the request was made with. */
  current: boolean;
}

export interface RefreshInput {
  refreshToken: string;
}

export interface LogoutInput {
  refreshToken?: string;
}

export interface AuthResult {
  session: Session;
  accessToken: string;
  refreshToken: string;
}

export interface CliStatus {
  connected: boolean;
  computerId: string | null;
}

/** Roles an invite or a role change can grant (`owner` only moves through a transfer). */
export type AssignableRole = Exclude<MemberRole, 'owner'>;

/** A pending (unaccepted, unrevoked, unexpired) invite, as owners and admins see it. */
export interface Invite {
  id: string;
  email: string;
  role: AssignableRole;
  departmentId: string | null;
  title: string | null;
  /** `null` when the inviter was removed since. */
  invitedByName: string | null;
  /** ISO timestamps. */
  createdAt: string;
  expiresAt: string;
}

export interface CreateInviteInput {
  email: string;
  role: AssignableRole;
  /** A live department of the workspace; the invitee joins it (and its room) on accept. */
  departmentId?: string;
  /** Copied onto the new member on accept. */
  title?: string;
}

/** `token` and `url` are returned once, so the admin can copy the link when mail is not set up. */
export interface CreateInviteResult {
  invite: Invite;
  token: string;
  url: string;
}

/** Public: what the accept screen shows before the invitee signs up. */
export interface InvitePreview {
  workspaceName: string;
  email: string;
  role: AssignableRole;
  invitedByName: string | null;
  expiresAt: string;
}

export interface AcceptInviteInput {
  token: string;
  name: string;
  password: string;
  /** Must be `true`. */
  acceptTerms: boolean;
}

export interface UpdateMemberRoleInput {
  role: AssignableRole;
}

export interface TransferOwnershipInput {
  memberId: string;
  /** The owner's current password. */
  password: string;
}

export interface UpdateWorkspaceInput {
  /** 1..80 characters after cleaning. */
  name: string;
}

export interface DeleteWorkspaceInput {
  /** The owner's current password. */
  password: string;
  /** Must equal the workspace name. */
  confirmName: string;
}
