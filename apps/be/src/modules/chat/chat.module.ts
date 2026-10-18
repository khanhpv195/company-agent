import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GatewayModule } from '../gateway/gateway.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { RoomMember } from './entities/room-member.entity';
import { MessageStore } from './message-store.service';
import { RoomMessagesController } from './room-messages.controller';
import { RoomsController } from './rooms.controller';
import { RoomStateController } from './room-state.controller';
import { RoomsService } from './rooms.service';
import { ChatMessage } from './entities/chat-message.entity';
import { Room } from './entities/room.entity';
import { ThreadRead } from './entities/thread-read.entity';
import { MessageMention } from './entities/message-mention.entity';
import { MessageReaction } from './entities/message-reaction.entity';
import { Pin } from './entities/pin.entity';
import { RoomMute } from './entities/room-mute.entity';
import { RoomRead } from './entities/room-read.entity';
import { ThreadMute } from './entities/thread-mute.entity';
import { MentionsFeedService } from './mentions-feed.service';
import { MessageReactionsService } from './message-reactions.service';
import { MentionsController } from './mentions.controller';
import { PinsController } from './pins.controller';
import { PinsService } from './pins.service';
import { ReadStateService } from './read-state.service';
import { TypingService } from './typing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Room,
      RoomMember,
      ChatMessage,
      ThreadRead,
      RoomRead,
      RoomMute,
      ThreadMute,
      MessageReaction,
      MessageMention,
      Pin,
    ]),
    GatewayModule,
  ],
  controllers: [
    ChatController,
    RoomsController,
    RoomStateController,
    RoomMessagesController,
    PinsController,
    MentionsController,
  ],
  providers: [
    ChatService,
    RoomsService,
    MessageStore,
    ReadStateService,
    MessageReactionsService,
    PinsService,
    MentionsFeedService,
    TypingService,
  ],
  exports: [ChatService, MessageStore],
})
export class ChatModule {}
