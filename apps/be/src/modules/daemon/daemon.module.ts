import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { BillingModule } from '../billing/billing.module';
import { ChatModule } from '../chat/chat.module';
import { ComputersModule } from '../computers/computers.module';
import { GatewayModule } from '../gateway/gateway.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AssignmentBriefService } from './assignment-brief.service';
import { ChatStreamService } from './chat-stream.service';
import { ComputerAdminService } from './computer-admin.service';
import { ComputerAuthGuard } from './computer-auth.guard';
import { ComputersAdminController } from './computers-admin.controller';
import { DaemonGatewayService } from './daemon-gateway.service';
import { GatewayController, GatewayPairController } from './gateway.controller';
import { GatewayToolsService } from './gateway-tools.service';
import { PairingService } from './pairing.service';

/**
 * The HTTP side of the gateway for real daemons (`@agent/cli`): pairing, API-key auth,
 * claim / accept / heartbeat / progress / result and the workspace tools. It sits on top of
 * the in-process `AgentGatewayService`, the task engine, chat and agents services.
 */
@Module({
  imports: [
    AgentsModule,
    BillingModule,
    ChatModule,
    ComputersModule,
    GatewayModule,
    TasksModule,
    WorkspaceModule,
  ],
  controllers: [GatewayPairController, GatewayController, ComputersAdminController],
  providers: [
    ComputerAuthGuard,
    PairingService,
    ComputerAdminService,
    AssignmentBriefService,
    ChatStreamService,
    DaemonGatewayService,
    GatewayToolsService,
  ],
})
export class DaemonModule {}
