import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { Assignment } from '../gateway/entities/assignment.entity';
import { Skill } from '../skills/entities/skill.entity';
import { TasksModule } from '../tasks/tasks.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentActivity } from './entities/agent-activity.entity';
import { Agent } from './entities/agent.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Agent, AgentActivity, Assignment, Skill]),
    TasksModule,
    BillingModule,
  ],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService, TypeOrmModule],
})
export class AgentsModule {}
