import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GatewayModule } from '../gateway/gateway.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatMessage } from './entities/chat-message.entity';
import { Room } from './entities/room.entity';
import { ThreadRead } from './entities/thread-read.entity';
import { Thread } from './entities/thread.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Room, Thread, ChatMessage, ThreadRead]), GatewayModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
