import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthResult, MemberRole } from '@repo/shared';
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
      password: 'correct-horse-battery',
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
  const accessToken = await new JwtService().signAsync(
    { sub: member.id, wid: owner.workspaceId, role },
    { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
  );
  return {
    accessToken,
    workspaceId: owner.workspaceId,
    memberId: member.id,
    bearer: { Authorization: `Bearer ${accessToken}` },
  };
};
