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
import { AgentDto } from '../agents/dto/agent.dto';
import { MemberDto } from '../workspace/dto/workspace.dto';
import { DepartmentsService } from './departments.service';
import {
  CreateDepartmentDto,
  DepartmentDto,
  ReorderDepartmentsDto,
  SetDepartmentDto,
  SetMemberTitleDto,
  UpdateDepartmentDto,
} from './dto/department.dto';

// Ids are validated inside the service: a malformed id is a 404, never a 400.
@ApiTags('departments')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @ResponseMessage('departments.LISTED')
  @ApiOperation({ summary: 'Departments of the caller workspace, by rank' })
  @ApiWrappedResponse(DepartmentDto, HttpStatus.OK, { isArray: true })
  list(@CurrentAuth() auth: AuthContext) {
    return this.departments.list(auth.workspaceId);
  }

  @Post()
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('departments.CREATED')
  @ApiOperation({ summary: 'Create a department and its public channel (owner|admin)' })
  @ApiWrappedResponse(DepartmentDto)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateDepartmentDto) {
    return this.departments.create(auth, dto);
  }

  // Declared before `:id` so the literal path is not taken as a department id.
  @Put('order')
  @Roles('owner', 'admin')
  @ResponseMessage('departments.REORDERED')
  @ApiOperation({ summary: 'Set the order: exactly the live department ids (owner|admin)' })
  @ApiWrappedResponse(DepartmentDto, HttpStatus.OK, { isArray: true })
  reorder(@CurrentAuth() auth: AuthContext, @Body() dto: ReorderDepartmentsDto) {
    return this.departments.reorder(auth, dto);
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  @ResponseMessage('departments.UPDATED')
  @ApiOperation({ summary: 'Rename a department or change its icon; its room keeps its name' })
  @ApiWrappedResponse(DepartmentDto)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.departments.update(auth, id, dto);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('departments.DELETED')
  @ApiOperation({
    summary: 'Delete a department (soft): people and agents become unassigned, the room stays',
  })
  @ApiWrappedResponse(null)
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.departments.remove(auth, id);
  }
}

/** Who belongs to which department, and their titles. */
@ApiTags('departments')
@ApiBearerAuth()
@Controller()
export class DepartmentAssignmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Put('members/:id/department')
  @Roles('owner', 'admin')
  @ResponseMessage('departments.ASSIGNED')
  @ApiOperation({ summary: 'Put a member in a department (or none); joins its room' })
  @ApiWrappedResponse(MemberDto)
  setMemberDepartment(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: SetDepartmentDto,
  ) {
    return this.departments.setMemberDepartment(auth, id, dto);
  }

  @Put('agents/:id/department')
  @Roles('owner', 'admin')
  @ResponseMessage('departments.ASSIGNED')
  @ApiOperation({ summary: 'Put an agent in a department (or none); joins its room' })
  @ApiWrappedResponse(AgentDto)
  setAgentDepartment(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: SetDepartmentDto,
  ) {
    return this.departments.setAgentDepartment(auth, id, dto);
  }

  @Put('members/:id/title')
  @Roles('owner', 'admin')
  @ResponseMessage('departments.TITLE_UPDATED')
  @ApiOperation({ summary: "Set a member's job title (people set their own through PATCH /me)" })
  @ApiWrappedResponse(MemberDto)
  setMemberTitle(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: SetMemberTitleDto,
  ) {
    return this.departments.setMemberTitle(auth, id, dto);
  }
}
