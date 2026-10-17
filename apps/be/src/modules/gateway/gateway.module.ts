import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agent } from '../agents/entities/agent.entity';
import { ComputersModule } from '../computers/computers.module';
import { AgentGatewayService } from './agent-gateway.service';
import { AgentSession } from './entities/agent-session.entity';
import { Assignment } from './entities/assignment.entity';
import { PairingCode } from './entities/pairing-code.entity';
import { ReconcileService } from './reconcile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Assignment, Agent, AgentSession, PairingCode]),
    ComputersModule,
  ],
  providers: [AgentGatewayService, ReconcileService],
  exports: [AgentGatewayService],
})
export class GatewayModule {}
