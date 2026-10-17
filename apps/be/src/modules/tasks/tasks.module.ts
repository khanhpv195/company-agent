import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../gateway/entities/assignment.entity';
import { GatewayModule } from '../gateway/gateway.module';
import { Workspace } from '../workspace/entities/workspace.entity';
import { TaskActivityRow } from './entities/task-activity.entity';
import { TaskRun } from './entities/task-run.entity';
import { TaskEntity } from './entities/task.entity';
import { RunSpansController } from './run-spans.controller';
import { SchedulerController } from './scheduler.controller';
import { TaskEngineService } from './task-engine.service';
import { TaskReconcileService } from './task-reconcile.service';
import { Random, TaskTimers } from './task-timers';
import { TasksController } from './tasks.controller';
import { TasksQueryService } from './tasks-query.service';
import { TasksService } from './tasks.service';
import { WorkspaceLockService } from './workspace-lock.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskEntity, TaskRun, TaskActivityRow, Assignment, Workspace]),
    GatewayModule,
  ],
  controllers: [TasksController, RunSpansController, SchedulerController],
  providers: [
    WorkspaceLockService,
    TaskTimers,
    Random,
    TaskEngineService,
    TasksQueryService,
    TasksService,
    TaskReconcileService,
  ],
  exports: [TaskEngineService, TasksQueryService, TaskTimers, Random, WorkspaceLockService],
})
export class TasksModule {}
