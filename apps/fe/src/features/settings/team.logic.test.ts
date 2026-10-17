import { describe, expect, it } from 'vitest';
import {
  buildInviteLink,
  canChangeRole,
  canInvite,
  canInviteAdmin,
  canRemove,
  confirmNameMatches,
  inviteLinkOf,
  isWorkspaceNameValid,
  transferCandidates,
} from './settings.logic';

const owner = { id: 'o', role: 'owner' as const };
const admin = { id: 'a', role: 'admin' as const };
const member = { id: 'm', role: 'member' as const };

describe('team permissions', () => {
  it('only the owner invites admins; owner and admin can invite', () => {
    expect(canInviteAdmin('owner')).toBe(true);
    expect(canInviteAdmin('admin')).toBe(false);
    expect(canInvite('admin')).toBe(true);
    expect(canInvite('member')).toBe(false);
    expect(canInvite(undefined)).toBe(false);
  });

  it('only the owner changes roles of others, never the owner row', () => {
    expect(canChangeRole(owner, admin)).toBe(true);
    expect(canChangeRole(owner, member)).toBe(true);
    expect(canChangeRole(owner, owner)).toBe(false);
    expect(canChangeRole(admin, member)).toBe(false);
    expect(canChangeRole(member, admin)).toBe(false);
  });

  it('owner removes anyone else; admin removes members only; nobody removes the owner or self', () => {
    expect(canRemove(owner, admin)).toBe(true);
    expect(canRemove(owner, member)).toBe(true);
    expect(canRemove(owner, owner)).toBe(false);
    expect(canRemove(admin, member)).toBe(true);
    expect(canRemove(admin, { id: 'a2', role: 'admin' })).toBe(false);
    expect(canRemove(admin, owner)).toBe(false);
    expect(canRemove(admin, admin)).toBe(false);
    expect(canRemove(member, { id: 'm2', role: 'member' })).toBe(false);
  });

  it('transfer candidates exclude the owner and are empty for non-owners', () => {
    const all = [{ ...owner }, { ...admin }, { ...member }];
    expect(transferCandidates(owner, all).map((m) => m.id)).toEqual(['a', 'm']);
    expect(transferCandidates(admin, all)).toEqual([]);
  });
});

describe('invite links and workspace forms', () => {
  it('builds a hash-route link with the token encoded', () => {
    expect(buildInviteLink('http://localhost:1420/', 'a b+c')).toBe(
      'http://localhost:1420/#/invite?token=a%20b%2Bc',
    );
  });

  it('prefers the API link over the built one', () => {
    expect(inviteLinkOf({ token: 't', url: 'https://x.io/#/invite?token=t' }, 'http://o')).toBe(
      'https://x.io/#/invite?token=t',
    );
    expect(inviteLinkOf({ token: 't', url: '' }, 'http://o')).toBe('http://o/#/invite?token=t');
  });

  it('validates the delete confirmation and the workspace name', () => {
    expect(confirmNameMatches(' Acme ', 'Acme')).toBe(true);
    expect(confirmNameMatches('acme', 'Acme')).toBe(false);
    expect(confirmNameMatches('', '')).toBe(false);
    expect(isWorkspaceNameValid('  ')).toBe(false);
    expect(isWorkspaceNameValid('x'.repeat(81))).toBe(false);
    expect(isWorkspaceNameValid('Acme')).toBe(true);
  });
});
