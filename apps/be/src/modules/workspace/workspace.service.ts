import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Member as MemberContract, MemberRole, Session } from '@repo/shared';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { ClockService } from '../../common/clock';
import { Member } from './entities/member.entity';
import { Workspace } from './entities/workspace.entity';
import { slugify } from './slug.util';
import { toMember, toSession } from './workspace.mapper';

export interface CreateWorkspaceWithOwnerInput {
  name: string;
  email: string;
  passwordHash: string;
  workspaceName: string;
}

@Injectable()
export class WorkspaceService {
  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(Workspace) private readonly workspaces: Repository<Workspace>,
    private readonly clock: ClockService,
  ) {}

  /** Runs inside the caller's transaction. Unique violations (email/slug) propagate. */
  async createWithOwner(
    manager: EntityManager,
    input: CreateWorkspaceWithOwnerInput,
  ): Promise<{ member: Member; workspace: Workspace }> {
    const workspace = await manager.save(
      manager.create(Workspace, {
        name: input.workspaceName,
        slug: await this.uniqueSlug(manager, slugify(input.workspaceName)),
        onboardedAt: null,
      }),
    );
    const member = await manager.save(
      manager.create(Member, {
        workspaceId: workspace.id,
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
        role: 'owner' satisfies MemberRole,
        color: null,
      }),
    );
    return { member, workspace };
  }

  async getSession(memberId: string): Promise<Session> {
    const member = await this.members.findOne({
      where: { id: memberId },
      relations: { workspace: true },
    });
    if (!member) throw new UnauthorizedException({ message: 'auth.UNAUTHORIZED' });
    return toSession(member, member.workspace);
  }

  async listMembers(workspaceId: string): Promise<MemberContract[]> {
    const rows = await this.members.find({
      where: { workspaceId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return rows.map(toMember);
  }

  /** Stamps `onboarded_at` once; later calls leave it untouched. */
  async markOnboarded(workspaceId: string): Promise<void> {
    await this.workspaces.update(
      { id: workspaceId, onboardedAt: IsNull() },
      { onboardedAt: this.clock.now() },
    );
  }

  async findWorkspace(id: string): Promise<Workspace | null> {
    return this.workspaces.findOne({ where: { id } });
  }

  private async uniqueSlug(manager: EntityManager, base: string): Promise<string> {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      if (!(await manager.exists(Workspace, { where: { slug: candidate } }))) return candidate;
    }
  }
}
