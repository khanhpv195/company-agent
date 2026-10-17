import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiWrappedResponse,
  CurrentAuth,
  Public,
  ReqMeta,
  RequestMeta,
  ResponseMessage,
  Roles,
} from '../../common/decorators';
import { AuthThrottlerGuard, MemberThrottlerGuard } from '../../common/guards';
import type { AuthContext } from '../../common/types';
import { AuthResultDto } from '../auth/dto/auth.dto';
import {
  AcceptInviteDto,
  CreateInviteDto,
  CreateInviteResultDto,
  InviteDto,
  InvitePreviewDto,
  InvitePreviewQueryDto,
} from './dto/team.dto';
import { InvitesService } from './invites.service';

@ApiTags('invites')
@ApiBearerAuth()
@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post()
  @Roles('owner', 'admin')
  @UseGuards(MemberThrottlerGuard)
  @ResponseMessage('invites.CREATED')
  @ApiOperation({ summary: 'Invite an email address (only the owner may invite admins)' })
  @ApiWrappedResponse(CreateInviteResultDto, HttpStatus.CREATED)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateInviteDto) {
    return this.invites.create(auth, dto);
  }

  @Get()
  @Roles('owner', 'admin')
  @ResponseMessage('invites.LISTED')
  @ApiOperation({ summary: 'Pending invites of the workspace' })
  @ApiWrappedResponse(InviteDto, HttpStatus.OK, { isArray: true })
  list(@CurrentAuth() auth: AuthContext) {
    return this.invites.list(auth.workspaceId);
  }

  // Declared before `:id` so the literal paths are never read as an id.
  @Get('preview')
  @Public()
  @UseGuards(AuthThrottlerGuard)
  @ResponseMessage('invites.PREVIEWED')
  @ApiOperation({ summary: 'What an invite link is for (public)' })
  @ApiWrappedResponse(InvitePreviewDto)
  preview(@Query() query: InvitePreviewQueryDto) {
    return this.invites.preview(query.token);
  }

  @Post('accept')
  @Public()
  @UseGuards(AuthThrottlerGuard)
  @ResponseMessage('invites.ACCEPTED')
  @ApiOperation({ summary: 'Accept an invite: creates the member and signs them in (public)' })
  @ApiWrappedResponse(AuthResultDto, HttpStatus.CREATED)
  accept(@Body() dto: AcceptInviteDto, @ReqMeta() meta: RequestMeta) {
    return this.invites.accept(dto, meta);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @ResponseMessage('invites.REVOKED')
  @ApiOperation({ summary: 'Revoke a pending invite' })
  @ApiWrappedResponse(null)
  async revoke(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<null> {
    await this.invites.revoke(auth, id);
    return null;
  }
}
