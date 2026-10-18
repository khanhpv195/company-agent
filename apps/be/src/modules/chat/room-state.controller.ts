import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { ThreadDto } from './dto/chat.dto';
import {
  MuteStateDto,
  ReadDto,
  ReadStateDto,
  ThreadListQueryDto,
  TypingDto,
  UnreadDto,
} from './dto/interactions.dto';
import { ReadStateService } from './read-state.service';
import { TypingService } from './typing.service';

// Read cursors, mutes, the thread list and typing of a room. Access follows the room (404 for a
// room the caller cannot open); read, unread and mute only ever touch the caller's own state.
@ApiTags('rooms')
@ApiBearerAuth()
@Controller('rooms')
export class RoomStateController {
  constructor(
    private readonly state: ReadStateService,
    private readonly typing: TypingService,
  ) {}

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.ROOMS_READ_ALL')
  @ApiOperation({ summary: 'Mark every room and thread the caller can see as read' })
  @ApiWrappedResponse(null)
  readAll(@CurrentAuth() auth: AuthContext) {
    return this.state.readAll(auth);
  }

  @Get(':id/threads')
  @ResponseMessage('chat.THREADS_LISTED')
  @ApiOperation({
    summary:
      'Threads of a room, most recently active first, with unread / mentions / cursor / mute',
  })
  @ApiWrappedResponse(ThreadDto, HttpStatus.OK, { isArray: true })
  threads(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Query() query: ThreadListQueryDto,
  ) {
    return this.state.listThreads(auth, id, query.filter, query.limit);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.READ_STATE_UPDATED')
  @ApiOperation({ summary: 'Read the main timeline through seq (monotonic)' })
  @ApiWrappedResponse(ReadStateDto)
  read(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ReadDto) {
    return this.state.markRoomRead(auth, id, dto.seq);
  }

  @Post(':id/unread')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.READ_STATE_UPDATED')
  @ApiOperation({
    summary: 'Mark the main timeline unread from throughSeq on (cursor = throughSeq - 1)',
  })
  @ApiWrappedResponse(ReadStateDto)
  unread(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: UnreadDto) {
    return this.state.markRoomUnread(auth, id, dto.throughSeq);
  }

  @Post(':id/threads/:rootId/read')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.READ_STATE_UPDATED')
  @ApiOperation({ summary: 'Read a thread through seq (monotonic)' })
  @ApiWrappedResponse(ReadStateDto)
  readThread(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('rootId') rootId: string,
    @Body() dto: ReadDto,
  ) {
    return this.state.markThreadRead(auth, id, rootId, dto.seq);
  }

  @Post(':id/threads/:rootId/unread')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.READ_STATE_UPDATED')
  @ApiOperation({ summary: 'Mark a thread unread from throughSeq on (cursor = throughSeq - 1)' })
  @ApiWrappedResponse(ReadStateDto)
  unreadThread(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('rootId') rootId: string,
    @Body() dto: UnreadDto,
  ) {
    return this.state.markThreadUnread(auth, id, rootId, dto.throughSeq);
  }

  @Post(':id/mute')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.ROOM_MUTED')
  @ApiOperation({ summary: 'Mute a room for the caller (idempotent)' })
  @ApiWrappedResponse(MuteStateDto)
  mute(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.state.muteRoom(auth, id, true);
  }

  @Delete(':id/mute')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.ROOM_UNMUTED')
  @ApiOperation({ summary: 'Unmute a room for the caller (idempotent)' })
  @ApiWrappedResponse(MuteStateDto)
  unmute(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.state.muteRoom(auth, id, false);
  }

  @Post(':id/threads/:rootId/mute')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.THREAD_MUTED')
  @ApiOperation({ summary: 'Mute a thread for the caller (idempotent)' })
  @ApiWrappedResponse(MuteStateDto)
  muteThread(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('rootId') rootId: string,
  ) {
    return this.state.muteThread(auth, id, rootId, true);
  }

  @Delete(':id/threads/:rootId/mute')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.THREAD_UNMUTED')
  @ApiOperation({ summary: 'Unmute a thread for the caller (idempotent)' })
  @ApiWrappedResponse(MuteStateDto)
  unmuteThread(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('rootId') rootId: string,
  ) {
    return this.state.muteThread(auth, id, rootId, false);
  }

  @Post(':id/typing')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.TYPING')
  @ApiOperation({
    summary: 'Tell the room audience the caller is typing (ephemeral, throttled to one per 2 s)',
  })
  @ApiWrappedResponse(null)
  typingIn(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: TypingDto) {
    return this.typing.typing(auth, id, dto.parentId);
  }
}
