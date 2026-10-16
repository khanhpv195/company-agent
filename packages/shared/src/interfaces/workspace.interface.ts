export type MemberRole = 'owner' | 'admin' | 'member';

export interface Member {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  /** Avatar background; the UI falls back to the default avatar color. */
  color: string | null;
}

export type WorkspacePlan = 'free' | 'pro' | 'team';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: WorkspacePlan;
}

export interface Session {
  user: Member;
  workspace: Workspace;
  onboarded: boolean;
}

export interface LoginInput {
  email: string;
}

export interface CliStatus {
  connected: boolean;
  computerId: string | null;
}
