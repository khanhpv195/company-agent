import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage, Roles } from '../../common/decorators';
import { MemberThrottlerGuard } from '../../common/guards';
import type { AuthContext } from '../../common/types';
import { MemberDto, WorkspaceDto } from '../workspace/dto/workspace.dto';
import {
  DeleteWorkspaceDto,
  TransferOwnershipDto,
  UpdateMemberRoleDto,
  UpdateWorkspaceDto,
} from './dto/team.dto';
import { TeamService } from './team.service';

@ApiTags('team')
@ApiBearerAuth()
@Controller('members')
export class TeamMembersController {
  constructor(private readonly team: TeamService) {}

  @Patch(':id')
  @Roles('owner')
  @ResponseMessage('workspace.ROLE_CHANGED')
  @ApiOperation({ summary: 'Change a member role (owner only; not self, not the owner)' })
  @ApiWrappedResponse(MemberDto)
  changeRole(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.team.changeRole(auth, id, dto);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @ResponseMessage('workspace.MEMBER_REMOVED')
  @ApiOperation({ summary: 'Remove a member (owner: anyone but self; admin: members only)' })
  @ApiWrappedResponse(null)
  async remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<null> {
    await this.team.removeMember(auth, id);
    return null;
  }
}

@ApiTags('team')
@ApiBearerAuth()
@Controller('workspace')
export class WorkspaceAdminController {
  constructor(private readonly team: TeamService) {}

  @Patch()
  @Roles('owner', 'admin')
  @ResponseMessage('workspace.RENAMED')
  @ApiOperation({ summary: 'Rename the workspace' })
  @ApiWrappedResponse(WorkspaceDto)
  rename(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateWorkspaceDto) {
    return this.team.rename(auth, dto);
  }

  @Post('transfer-ownership')
  @Roles('owner')
  @UseGuards(MemberThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('workspace.OWNERSHIP_TRANSFERRED')
  @ApiOperation({ summary: 'Hand the workspace to another member; the caller becomes admin' })
  @ApiWrappedResponse(null)
  async transfer(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: TransferOwnershipDto,
  ): Promise<null> {
    await this.team.transferOwnership(auth, dto);
    return null;
  }

  @Delete()
  @Roles('owner')
  @UseGuards(MemberThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('workspace.DELETED')
  @ApiOperation({ summary: 'Delete the workspace and everything in it (owner, irreversible)' })
  @ApiWrappedResponse(null)
  async delete(@CurrentAuth() auth: AuthContext, @Body() dto: DeleteWorkspaceDto): Promise<null> {
    await this.team.deleteWorkspace(auth, dto);
    return null;
  }
}
