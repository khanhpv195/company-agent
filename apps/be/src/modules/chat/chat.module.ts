import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GatewayModule } from '../gateway/gateway.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { RoomMember } from './entities/room-member.entity';
import { MessageStore } from './message-store.service';
import { RoomMessagesController } from './room-messages.controller';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { ChatMessage } from './entities/chat-message.entity';
import { Room } from './entities/room.entity';
import { ThreadRead } from './entities/thread-read.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Room, RoomMember, ChatMessage, ThreadRead]), GatewayModule],
  controllers: [ChatController, RoomsController, RoomMessagesController],
  providers: [ChatService, RoomsService, MessageStore],
  exports: [ChatService, MessageStore],
})
export class ChatModule {}
