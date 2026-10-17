import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agent } from '../agents/entities/agent.entity';
import { ComputersModule } from '../computers/computers.module';
import { AgentGatewayService } from './agent-gateway.service';
import { Assignment } from './entities/assignment.entity';
import { ReconcileService } from './reconcile.service';

@Module({
  imports: [TypeOrmModule.forFeature([Assignment, Agent]), ComputersModule],
  providers: [AgentGatewayService, ReconcileService],
  exports: [AgentGatewayService],
})
export class GatewayModule {}
