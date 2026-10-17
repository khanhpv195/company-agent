import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { MemberDto } from './dto/workspace.dto';
import { WorkspaceService } from './workspace.service';

@ApiTags('workspace')
@ApiBearerAuth()
@Controller('members')
export class MembersController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get()
  @ResponseMessage('workspace.MEMBERS_LISTED')
  @ApiOperation({ summary: 'Members of the caller workspace' })
  @ApiWrappedResponse(MemberDto, HttpStatus.OK, { isArray: true })
  list(@CurrentAuth() auth: AuthContext) {
    return this.workspace.listMembers(auth.workspaceId);
  }
}
