import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardModule } from '../dashboard/dashboard.module';
import { TasksModule } from '../tasks/tasks.module';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { WorkspaceConnection } from './entities/workspace-connection.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WorkspaceConnection]), TasksModule, DashboardModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService],
})
export class ConnectionsModule {}
