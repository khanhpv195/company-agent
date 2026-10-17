import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthResult, MemberRole } from '@repo/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Member } from '../../src/modules/workspace/entities/member.entity';

export interface LoggedInClient {
  accessToken: string;
  workspaceId: string;
  memberId: string;
  /** Authorization header for supertest `.set(...)`. */
  bearer: { Authorization: string };
}

let counter = 0;

/** Registers a fresh member + workspace and returns its credentials. */
export const registerAndLogin = async (
  app: INestApplication<App>,
  overrides: { name?: string; email?: string; workspaceName?: string } = {},
): Promise<LoggedInClient> => {
  counter += 1;
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({
      name: 'Member',
      email: `member${counter}-${Date.now()}@example.com`,
      password: 'correct-horse-battery1',
      acceptTerms: true,
      ...overrides,
    })
    .expect(201);
  const { session, accessToken } = (response.body as { data: AuthResult }).data;
  return {
    accessToken,
    workspaceId: session.workspace.id,
    memberId: session.user.id,
    bearer: { Authorization: `Bearer ${accessToken}` },
  };
};

/**
 * An access token for an existing member, backed by a live session (a refresh-token row), which
 * the guard requires: no `sid`, or a `sid` without a live refresh family, is a 401.
 */
export const mintAccessToken = async (
  dataSource: DataSource,
  claims: { memberId: string; workspaceId: string; role: MemberRole },
  expiresIn: number | string = '15m',
): Promise<string> => {
  const sid = randomUUID();
  await dataSource.query(
    `INSERT INTO refresh_tokens (member_id, family_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '30 days')`,
    [claims.memberId, sid, randomUUID().replace(/-/g, '').repeat(2)],
  );
  return new JwtService().signAsync(
    { sub: claims.memberId, wid: claims.workspaceId, role: claims.role, sid },
    { secret: process.env.JWT_ACCESS_SECRET, expiresIn: expiresIn as number },
  );
};

/** A second member of `owner`'s workspace with the given role, signed in via a minted token. */
export const addMemberWithRole = async (
  dataSource: DataSource,
  owner: LoggedInClient,
  role: MemberRole,
): Promise<LoggedInClient> => {
  counter += 1;
  const repo = dataSource.getRepository(Member);
  const member = await repo.save(
    repo.create({
      workspaceId: owner.workspaceId,
      name: `Extra ${role}`,
      email: `${role}-${counter}-${Date.now()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      color: null,
    }),
  );
  const accessToken = await mintAccessToken(dataSource, {
    memberId: member.id,
    workspaceId: owner.workspaceId,
    role,
  });
  return {
    accessToken,
    workspaceId: owner.workspaceId,
    memberId: member.id,
    bearer: { Authorization: `Bearer ${accessToken}` },
  };
};

/** New workspaces start on `free` (3 seats, 2 agents, 1 computer): move one to a bigger plan. */
export const setPlan = async (
  dataSource: DataSource,
  workspaceId: string,
  plan: 'free' | 'pro' | 'team',
): Promise<void> => {
  await dataSource.query('UPDATE workspaces SET plan = $2 WHERE id = $1', [workspaceId, plan]);
};
