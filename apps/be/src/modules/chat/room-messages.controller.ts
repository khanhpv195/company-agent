import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import {
  EditMessageDto,
  MessageDto,
  PostRoomMessageDto,
  RenameThreadDto,
  RoomTimelinePageDto,
  ThreadPageDto,
  ThreadQueryDto,
  TimelineQueryDto,
} from './dto/chat.dto';
import { MessageReactionsService } from './message-reactions.service';
import { MessageStore } from './message-store.service';

// Every action answers 200 (like the other chat routes and the desktop mock). Access follows the
// room: a DM only for its member, a private channel only for its members, inboxes for everybody.
@ApiTags('rooms')
@ApiBearerAuth()
@Controller('rooms/:id/messages')
export class RoomMessagesController {
  constructor(
    private readonly store: MessageStore,
    private readonly reactions: MessageReactionsService,
  ) {}

  @Get()
  @ResponseMessage('chat.MESSAGES_LISTED')
  @ApiOperation({ summary: 'The main timeline of a room, oldest first within the page' })
  @ApiWrappedResponse(RoomTimelinePageDto)
  timeline(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Query() query: TimelineQueryDto,
  ) {
    return this.store.timeline(auth, id, query);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.MESSAGE_SENT')
  @ApiOperation({
    summary:
      'Post to the main timeline, to a thread (parentId) or start a titled thread (threadTitle); mentioned agents reply',
  })
  @ApiWrappedResponse(MessageDto)
  send(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: PostRoomMessageDto) {
    return this.store.send(auth, id, dto);
  }

  @Get(':rootId/thread')
  @ResponseMessage('chat.THREAD_LOADED')
  @ApiOperation({ summary: 'A thread: its root and replies after afterSeq' })
  @ApiWrappedResponse(ThreadPageDto)
  thread(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('rootId') rootId: string,
    @Query() query: ThreadQueryDto,
  ) {
    return this.store.thread(auth, id, rootId, query);
  }

  @Patch(':rootId/thread')
  @ResponseMessage('chat.THREAD_RENAMED')
  @ApiOperation({ summary: 'Rename a thread (root author, room owner, owner/admin)' })
  @ApiWrappedResponse(MessageDto)
  renameThread(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('rootId') rootId: string,
    @Body() dto: RenameThreadDto,
  ) {
    return this.store.renameThread(auth, id, rootId, dto.title);
  }

  @Patch(':messageId')
  @ResponseMessage('chat.MESSAGE_EDITED')
  @ApiOperation({ summary: 'Edit one of your own messages' })
  @ApiWrappedResponse(MessageDto)
  edit(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.store.edit(auth, id, messageId, dto.markdown);
  }

  @Delete(':messageId')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.MESSAGE_DELETED')
  @ApiOperation({
    summary: 'Soft-delete a message (author, room owner, owner/admin); answers the placeholder',
  })
  @ApiWrappedResponse(MessageDto)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.store.remove(auth, id, messageId);
  }

  @Put(':messageId/reactions/:key')
  @ResponseMessage('chat.REACTION_ADDED')
  @ApiOperation({
    summary: 'React with an emoji (URL-encode it); idempotent; answers the message with `mine`',
  })
  @ApiWrappedResponse(MessageDto)
  react(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Param('key') key: string,
  ) {
    return this.reactions.set(auth, id, messageId, key);
  }

  @Delete(':messageId/reactions/:key')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.REACTION_REMOVED')
  @ApiOperation({ summary: 'Remove your emoji reaction; idempotent; answers the message' })
  @ApiWrappedResponse(MessageDto)
  unreact(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Param('key') key: string,
  ) {
    return this.reactions.unset(auth, id, messageId, key);
  }

  @Post(':messageId/stop')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.MESSAGE_STOPPED')
  @ApiOperation({
    summary:
      'Stop an agent reply being written (the requester, the room owner, owner/admin); the message ends `stopped` with its partial text',
  })
  @ApiWrappedResponse(MessageDto)
  stop(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.store.stop(auth, id, messageId);
  }
}
