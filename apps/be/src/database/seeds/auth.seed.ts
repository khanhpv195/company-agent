import { Logger } from '@nestjs/common';
import type { MemberRole, WorkspacePlan } from '@repo/shared';
import * as argon2 from 'argon2';
import type { DataSource } from 'typeorm';
import { Member } from '../../modules/workspace/entities/member.entity';
import { Workspace } from '../../modules/workspace/entities/workspace.entity';

const DEV_PASSWORD = 'password123';

/** Port of the FE mock fixtures (apps/fe/src/mocks/fixtures.ts). */
const WORKSPACE: { name: string; slug: string; plan: WorkspacePlan } = {
  name: 'khanhpv workspace',
  slug: 'khanhpv',
  plan: 'pro',
};
const MEMBERS: { name: string; email: string; role: MemberRole; color: string | null }[] = [
  { name: 'khanhpv', email: 'khanhpv@holatech.tech', role: 'owner', color: null },
  { name: 'Hằng', email: 'hang@holatech.tech', role: 'member', color: '#b0516f' },
  { name: 'Minh', email: 'minh@holatech.tech', role: 'admin', color: '#3d8a6a' },
];

const resolvePassword = (): string => {
  const fromEnv = process.env.SEED_PASSWORD;
  if (process.env.NODE_ENV === 'production' && !fromEnv) {
    throw new Error('Refusing to seed users in production without SEED_PASSWORD');
  }
  return fromEnv || DEV_PASSWORD;
};

/** Idempotent: the workspace is matched by slug and members by email. */
export const seedAuth = async (ds: DataSource): Promise<void> => {
  const logger = new Logger('Seed:auth');
  const password = resolvePassword();

  await ds.transaction(async (manager) => {
    let workspace = await manager.findOne(Workspace, { where: { slug: WORKSPACE.slug } });
    if (workspace && workspace.plan === 'free') {
      // Older dev databases were seeded on the free plan, which is too small for the demo data.
      workspace.plan = 'pro';
      await manager.save(workspace);
    }
    if (!workspace) {
      workspace = await manager.save(
        manager.create(Workspace, { ...WORKSPACE, onboardedAt: new Date() }),
      );
      logger.log(`Created workspace ${WORKSPACE.slug}`);
    }

    for (const data of MEMBERS) {
      if (await manager.exists(Member, { where: { email: data.email } })) continue;
      await manager.save(
        manager.create(Member, {
          ...data,
          workspaceId: workspace.id,
          passwordHash: await argon2.hash(password),
          // Dev members need no email round trip: verified and past the terms.
          emailVerifiedAt: new Date(),
          termsAcceptedAt: new Date(),
          passwordChangedAt: new Date(),
        }),
      );
      logger.log(`Created member ${data.email}`);
    }
  });
};
