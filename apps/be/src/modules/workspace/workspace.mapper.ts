import type {
  Member as MemberContract,
  MemberRole,
  Session,
  SessionUser,
  Workspace as WorkspaceContract,
  WorkspacePlan,
} from '@repo/shared';
import { Member } from './entities/member.entity';
import { Workspace } from './entities/workspace.entity';

/** Explicit field picks: entities are never serialised directly (password_hash must not leak). */
export const toMember = (member: Member): MemberContract => ({
  id: member.id,
  name: member.name,
  email: member.email,
  role: member.role as MemberRole,
  color: member.color,
  departmentId: member.departmentId,
  title: member.title,
});

export const toSessionUser = (member: Member): SessionUser => ({
  ...toMember(member),
  emailVerified: member.emailVerifiedAt !== null,
});

export const toWorkspace = (workspace: Workspace): WorkspaceContract => ({
  id: workspace.id,
  name: workspace.name,
  slug: workspace.slug,
  plan: workspace.plan as WorkspacePlan,
});

export const toSession = (member: Member, workspace: Workspace): Session => ({
  user: toSessionUser(member),
  workspace: toWorkspace(workspace),
  onboarded: workspace.onboardedAt !== null,
});
