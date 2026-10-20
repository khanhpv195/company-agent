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
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage, Roles } from '../../common/decorators';
import type { AuthContext } from '../../common/types';
import { AgentsService } from '../agents/agents.service';
import { AgentDto } from '../agents/dto/agent.dto';
import {
  CreateSkillDto,
  RestoreSkillDto,
  SetAgentSkillsDto,
  SkillDto,
  SkillVersionDto,
  UpdateSkillDto,
} from './dto/skill.dto';
import { SkillsService } from './skills.service';

// Ids are validated inside the service: a malformed id is a 404, never a 400.
@ApiTags('skills')
@ApiBearerAuth()
@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  @ResponseMessage('skills.LISTED')
  @ApiOperation({
    summary: 'The skill library of the caller workspace, with the agents using each',
  })
  @ApiWrappedResponse(SkillDto, HttpStatus.OK, { isArray: true })
  list(@CurrentAuth() auth: AuthContext) {
    return this.skills.list(auth.workspaceId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('skills.CREATED')
  @ApiOperation({ summary: 'Add a skill to the library (any member), blank or from a template' })
  @ApiWrappedResponse(SkillDto)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateSkillDto) {
    return this.skills.create(auth, dto);
  }

  @Get(':id')
  @ResponseMessage('skills.LOADED')
  @ApiOperation({ summary: 'One skill' })
  @ApiWrappedResponse(SkillDto)
  get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.skills.get(auth.workspaceId, id);
  }

  @Get(':id/versions')
  @ResponseMessage('skills.VERSIONS_LISTED')
  @ApiOperation({ summary: 'Saved versions of a skill, newest first' })
  @ApiWrappedResponse(SkillVersionDto, HttpStatus.OK, { isArray: true })
  versions(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.skills.versions(auth.workspaceId, id);
  }

  @Patch(':id')
  @ResponseMessage('skills.UPDATED')
  @ApiOperation({
    summary: 'Edit a skill (creator, owner or admin); a content change makes a new version',
  })
  @ApiWrappedResponse(SkillDto)
  update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateSkillDto) {
    return this.skills.update(auth, id, dto);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('skills.RESTORED')
  @ApiOperation({ summary: 'Copy an older version into a new one (creator, owner or admin)' })
  @ApiWrappedResponse(SkillDto)
  restore(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: RestoreSkillDto) {
    return this.skills.restore(auth, id, dto);
  }

  @Post(':id/approve')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('skills.APPROVED')
  @ApiOperation({
    summary:
      'Mark a skill as reviewed (owner|admin): the caller becomes its last editor without a new ' +
      'version, so agents using it get admin tools again. Idempotent',
  })
  @ApiWrappedResponse(SkillDto)
  approve(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.skills.approve(auth, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('skills.DELETED')
  @ApiOperation({
    summary:
      'Delete a skill (soft; creator, owner or admin); 409 skills.IN_USE while an agent has it on',
  })
  @ApiWrappedResponse(null)
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.skills.remove(auth, id);
  }
}

/** Which skills an agent has on. */
@ApiTags('skills')
@ApiBearerAuth()
@Controller()
export class AgentSkillsController {
  constructor(private readonly agents: AgentsService) {}

  @Put('agents/:id/skills')
  @ResponseMessage('skills.AGENT_SKILLS_UPDATED')
  @ApiOperation({
    summary:
      "Set the full set of skills enabled on an agent (owner|admin, or a member of the agent's department)",
  })
  @ApiWrappedResponse(AgentDto)
  setAgentSkills(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: SetAgentSkillsDto,
  ) {
    return this.agents.setSkills(auth, id, dto.skillIds);
  }
}
