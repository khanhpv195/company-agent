import { Body, Controller, Get, HttpStatus, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PresenceEntry } from '@repo/shared';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import type { AuthContext } from '../../common/types';
import { PresenceEntryDto, PresenceStatusDto } from '../chat/dto/interactions.dto';
import { EventsService } from './events.service';

/** Who is online, derived from the open realtime streams of the workspace's members. */
@ApiTags('presence')
@ApiBearerAuth()
@Controller('presence')
export class PresenceController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ResponseMessage('chat.PRESENCE_LISTED')
  @ApiOperation({
    summary: 'Members with an open realtime stream (online or idle); anybody absent is offline',
  })
  @ApiWrappedResponse(PresenceEntryDto, HttpStatus.OK, { isArray: true })
  list(@CurrentAuth() auth: AuthContext): PresenceEntry[] {
    return this.events.presenceSnapshot(auth.workspaceId);
  }

  @Put()
  @ResponseMessage('chat.PRESENCE_SET')
  @ApiOperation({ summary: 'The client reports it is idle or active again (needs an open stream)' })
  @ApiWrappedResponse(null)
  set(@CurrentAuth() auth: AuthContext, @Body() dto: PresenceStatusDto): null {
    this.events.setIdle(auth.workspaceId, auth.memberId, dto.status === 'idle', auth.sessionId);
    return null;
  }
}
