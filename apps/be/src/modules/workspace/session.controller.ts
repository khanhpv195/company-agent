import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { SessionDto } from './dto/workspace.dto';
import { WorkspaceService } from './workspace.service';

@ApiTags('workspace')
@ApiBearerAuth()
@Controller('session')
export class SessionController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get()
  @ResponseMessage('workspace.SESSION_LOADED')
  @ApiOperation({ summary: 'Current member, workspace and onboarding state' })
  @ApiWrappedResponse(SessionDto)
  get(@CurrentAuth() auth: AuthContext) {
    return this.workspace.getSession(auth.memberId);
  }
}
