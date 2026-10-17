import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModule } from '../account/account.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { Invite } from './entities/invite.entity';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';
import { TeamMembersController, WorkspaceAdminController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invite]),
    AuthModule,
    AccountModule,
    WorkspaceModule,
    BillingModule,
  ],
  controllers: [InvitesController, TeamMembersController, WorkspaceAdminController],
  providers: [InvitesService, TeamService],
})
export class TeamModule {}
