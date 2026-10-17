import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatModule } from '../chat/chat.module';
import { ComputersModule } from '../computers/computers.module';
import { Assignment } from '../gateway/entities/assignment.entity';
import { GatewayModule } from '../gateway/gateway.module';
import { TasksModule } from '../tasks/tasks.module';
import { SimulatorChatRunner } from './simulator-chat-runner.service';
import { SimulatorTaskRunner } from './simulator-task-runner.service';
import { SimulatorService } from './simulator.service';

@Module({
  imports: [
    ChatModule,
    ComputersModule,
    GatewayModule,
    TasksModule,
    TypeOrmModule.forFeature([Assignment]),
  ],
  providers: [SimulatorService, SimulatorTaskRunner, SimulatorChatRunner],
})
export class SimulatorModule {}
