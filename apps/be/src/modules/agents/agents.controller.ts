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
import { ApiWrappedResponse, CurrentAuth, Roles, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { AgentsService } from './agents.service';
import { AgentActivityDto, AgentDto, CreateAgentDto, UpdateAgentDto } from './dto/agent.dto';

// Ids are validated inside the service: a malformed id (the FE may still hold mock ids)
// is a 404 on /agents/:id and an empty list on /agents/:id/activity, never a 400.
@ApiTags('agents')
@ApiBearerAuth()
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @ResponseMessage('agents.LISTED')
  @ApiOperation({ summary: 'Agents of the caller workspace (status derived)' })
  @ApiWrappedResponse(AgentDto, HttpStatus.OK, { isArray: true })
  list(@CurrentAuth() auth: AuthContext) {
    return this.agents.list(auth.workspaceId);
  }

  @Post()
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('agents.CREATED')
  @ApiOperation({ summary: 'Create an agent on one of the workspace computers' })
  @ApiWrappedResponse(AgentDto)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateAgentDto) {
    return this.agents.create(auth.workspaceId, dto, { memberId: auth.memberId, ip: auth.ip });
  }

  @Get(':id')
  @ResponseMessage('agents.LOADED')
  @ApiOperation({ summary: 'One agent' })
  @ApiWrappedResponse(AgentDto)
  get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.agents.get(auth.workspaceId, id);
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  @ResponseMessage('agents.UPDATED')
  @ApiOperation({ summary: 'Update an agent: name, computer, workdir, max turns, persona, skills' })
  @ApiWrappedResponse(AgentDto)
  update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agents.update(auth.workspaceId, id, dto, { memberId: auth.memberId, ip: auth.ip });
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('agents.DELETED')
  @ApiOperation({
    summary:
      'Delete an agent (soft): cancels its run and chat replies, unassigns its tasks, hides its DMs',
  })
  @ApiWrappedResponse(null)
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.agents.remove(auth.workspaceId, { memberId: auth.memberId, ip: auth.ip }, id);
  }

  @Get(':id/activity')
  @ResponseMessage('agents.ACTIVITY_LISTED')
  @ApiOperation({ summary: 'Recent activity of an agent, newest first (max 50)' })
  @ApiWrappedResponse(AgentActivityDto, HttpStatus.OK, { isArray: true })
  activity(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.agents.listActivity(auth.workspaceId, id);
  }
}
