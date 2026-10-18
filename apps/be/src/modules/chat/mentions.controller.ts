import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { MentionFeedPageDto, MentionsQueryDto } from './dto/interactions.dto';
import { MentionsFeedService } from './mentions-feed.service';

@ApiTags('mentions')
@ApiBearerAuth()
@Controller('mentions')
export class MentionsController {
  constructor(private readonly feed: MentionsFeedService) {}

  @Get()
  @ResponseMessage('chat.MENTIONS_LISTED')
  @ApiOperation({
    summary: 'Messages that mention the caller (or @here / @room) across their rooms, newest first',
  })
  @ApiWrappedResponse(MentionFeedPageDto, HttpStatus.OK)
  list(@CurrentAuth() auth: AuthContext, @Query() query: MentionsQueryDto) {
    return this.feed.list(auth, query);
  }
}
