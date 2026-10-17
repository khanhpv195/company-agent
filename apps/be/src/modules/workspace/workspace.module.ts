import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member } from './entities/member.entity';
import { Workspace } from './entities/workspace.entity';
import { MembersController } from './members.controller';
import { SessionController } from './session.controller';
import { WorkspaceService } from './workspace.service';

@Module({
  imports: [TypeOrmModule.forFeature([Workspace, Member])],
  controllers: [SessionController, MembersController],
  providers: [WorkspaceService],
  exports: [WorkspaceService, TypeOrmModule],
})
export class WorkspaceModule {}
