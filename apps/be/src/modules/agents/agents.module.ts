import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../gateway/entities/assignment.entity';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentActivity } from './entities/agent-activity.entity';
import { Agent } from './entities/agent.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Agent, AgentActivity, Assignment])],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService, TypeOrmModule],
})
export class AgentsModule {}
