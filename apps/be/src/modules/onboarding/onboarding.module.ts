import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { ComputersModule } from '../computers/computers.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [WorkspaceModule, ComputersModule, AgentsModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
