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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { MessageDto, RoomDto } from './dto/chat.dto';
import {
  AddRoomMembersDto,
  BrowseRoomDto,
  CreateRoomDto,
  CreateThreadDto,
  RoomMembersDto,
  UpdateRoomDto,
} from './dto/rooms.dto';
import { RoomsService } from './rooms.service';

// Every action answers 200 (like the other chat routes and the desktop mock).
@ApiTags('rooms')
@ApiBearerAuth()
@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get('browse')
  @ResponseMessage('chat.ROOMS_BROWSED')
  @ApiOperation({ summary: 'Public channels the caller has not joined' })
  @ApiWrappedResponse(BrowseRoomDto, HttpStatus.OK, { isArray: true })
  browse(@CurrentAuth() auth: AuthContext) {
    return this.rooms.browse(auth);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.ROOM_CREATED')
  @ApiOperation({ summary: 'Create a channel (the caller joins as its owner)' })
  @ApiWrappedResponse(RoomDto)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateRoomDto) {
    return this.rooms.create(auth, dto);
  }

  @Patch(':id')
  @ResponseMessage('chat.ROOM_UPDATED')
  @ApiOperation({ summary: 'Rename a channel or change its privacy (room owner, owner/admin)' })
  @ApiWrappedResponse(RoomDto)
  update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateRoomDto) {
    return this.rooms.update(auth, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.ROOM_DELETED')
  @ApiOperation({ summary: 'Delete a channel with its threads and messages' })
  @ApiWrappedResponse(null)
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.rooms.remove(auth, id);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.ROOM_JOINED')
  @ApiOperation({ summary: 'Join a public channel' })
  @ApiWrappedResponse(RoomDto)
  join(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.rooms.join(auth, id);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.ROOM_LEFT')
  @ApiOperation({ summary: 'Leave a channel' })
  @ApiWrappedResponse(null)
  leave(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.rooms.leave(auth, id);
  }

  @Get(':id/members')
  @ResponseMessage('chat.ROOM_MEMBERS_LISTED')
  @ApiOperation({ summary: 'Members and agents of a channel' })
  @ApiWrappedResponse(RoomMembersDto)
  members(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.rooms.members(auth, id);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.ROOM_MEMBERS_ADDED')
  @ApiOperation({ summary: 'Add members and agents to a channel' })
  @ApiWrappedResponse(RoomMembersDto)
  addMembers(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: AddRoomMembersDto,
  ) {
    return this.rooms.addMembers(auth, id, dto);
  }

  @Delete(':id/members/:kind/:targetId')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.ROOM_MEMBER_REMOVED')
  @ApiOperation({
    summary: 'Remove a member or agent (kind = member | agent); members may remove themselves',
  })
  @ApiWrappedResponse(RoomMembersDto)
  removeMember(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Param('targetId') targetId: string,
  ) {
    return this.rooms.removeMember(auth, id, kind, targetId);
  }

  @Post(':id/threads')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.THREAD_CREATED')
  @ApiOperation({
    summary:
      'Compatibility wrapper: post a titled root message (a new thread) in a channel; answers with that root Message (not a thread object); only the message text is searched for @mentions',
  })
  @ApiWrappedResponse(MessageDto)
  createThread(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: CreateThreadDto,
  ) {
    return this.rooms.createThread(auth, id, dto);
  }
}
