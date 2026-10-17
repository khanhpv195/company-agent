import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { ChatService } from './chat.service';
import { ChatDto, DmChatDto, MessageDto, RoomDto, SendMessageDto } from './dto/chat.dto';

// Routes are spelled out per handler (rooms, chats, agents/:id/dm, messages): the desktop
// app's mock exposes them flat. Every action answers 200, like the mock.
@ApiTags('chat')
@ApiBearerAuth()
@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('rooms')
  @ResponseMessage('chat.ROOMS_LISTED')
  @ApiOperation({ summary: 'Channels of the workspace and the caller own DMs' })
  @ApiWrappedResponse(RoomDto, HttpStatus.OK, { isArray: true })
  rooms(@CurrentAuth() auth: AuthContext) {
    return this.chat.listRooms(auth);
  }

  @Get('chats/:id')
  @ResponseMessage('chat.LOADED')
  @ApiOperation({ summary: 'A thread or a DM of the caller' })
  @ApiWrappedResponse(ChatDto)
  get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.chat.getChat(auth, id);
  }

  @Get('chats/:id/messages')
  @ResponseMessage('chat.MESSAGES_LISTED')
  @ApiOperation({ summary: 'The latest 200 messages, oldest first' })
  @ApiWrappedResponse(MessageDto, HttpStatus.OK, { isArray: true })
  messages(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.chat.listMessages(auth, id);
  }

  @Post('chats/:id/messages')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.MESSAGE_SENT')
  @ApiOperation({ summary: 'Post a message; the addressed agent replies asynchronously' })
  @ApiWrappedResponse(MessageDto)
  send(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.chat.sendMessage(auth, id, dto);
  }

  @Post('chats/:id/read')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.READ')
  @ApiOperation({ summary: 'Mark a chat read for the caller (unknown chats are ignored)' })
  @ApiWrappedResponse(null)
  read(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.chat.markRead(auth, id);
  }

  @Post('agents/:id/dm')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.DM_READY')
  @ApiOperation({ summary: 'Get or create the caller DM with an agent' })
  @ApiWrappedResponse(DmChatDto)
  dm(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.chat.ensureDm(auth, id);
  }

  @Post('messages/:id/send-draft')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.DRAFT_SENT')
  @ApiOperation({ summary: 'Mark an agent draft reply as sent' })
  @ApiWrappedResponse(MessageDto)
  sendDraft(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.chat.sendDraft(auth, id);
  }
}
