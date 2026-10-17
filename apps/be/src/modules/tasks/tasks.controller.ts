import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import {
  CommentDto,
  CreateTaskDto,
  MoveTaskDto,
  ReviseTaskDto,
  TaskDto,
  UpdateTaskDto,
} from './dto/task.dto';
import { TasksService } from './tasks.service';

// Every action returns the updated task with 200 (the desktop app expects the mock's shape).
@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ResponseMessage('tasks.LISTED')
  @ApiOperation({ summary: 'The board of the caller workspace, sorted by rank' })
  @ApiWrappedResponse(TaskDto, HttpStatus.OK, { isArray: true })
  list(@CurrentAuth() auth: AuthContext) {
    return this.tasks.list(auth);
  }

  @Get(':id')
  @ResponseMessage('tasks.LISTED')
  @ApiOperation({ summary: 'One task of the caller workspace by key (e.g. AG-15)' })
  @ApiWrappedResponse(TaskDto)
  get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.tasks.get(auth, id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('tasks.CREATED')
  @ApiOperation({ summary: 'Create a task (starts it when assigned to an idle agent)' })
  @ApiWrappedResponse(TaskDto)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateTaskDto) {
    return this.tasks.create(auth, dto);
  }

  @Patch(':id')
  @ResponseMessage('tasks.UPDATED')
  @ApiOperation({ summary: 'Reassign, change priority/review flag, replace the checklist' })
  @ApiWrappedResponse(TaskDto)
  update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(auth, id, dto);
  }

  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('tasks.MOVED')
  @ApiOperation({ summary: 'Move to a column (and position); "doing" starts or queues the run' })
  @ApiWrappedResponse(TaskDto)
  move(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: MoveTaskDto) {
    return this.tasks.move(auth, id, dto);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('tasks.APPROVED')
  @ApiOperation({ summary: 'Approve a task waiting for review' })
  @ApiWrappedResponse(TaskDto)
  approve(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.tasks.approve(auth, id);
  }

  @Post(':id/revise')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('tasks.REVISED')
  @ApiOperation({ summary: 'Send the task back for another run, with an optional note' })
  @ApiWrappedResponse(TaskDto)
  revise(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ReviseTaskDto) {
    return this.tasks.revise(auth, id, dto);
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('tasks.STOPPED')
  @ApiOperation({ summary: 'Stop the running run; the task returns to todo' })
  @ApiWrappedResponse(TaskDto)
  stop(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.tasks.stop(auth, id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('tasks.RETRIED')
  @ApiOperation({ summary: 'Clear the error and run again' })
  @ApiWrappedResponse(TaskDto)
  retry(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.tasks.retry(auth, id);
  }

  @Post(':id/run-now')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('tasks.RUN_NOW')
  @ApiOperation({ summary: 'Jump the queue: run now, or go first in line as urgent' })
  @ApiWrappedResponse(TaskDto)
  runNow(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.tasks.runNow(auth, id);
  }

  @Post(':id/comments')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('tasks.COMMENTED')
  @ApiOperation({ summary: 'Comment on a task (mention an agent to get an acknowledgement)' })
  @ApiWrappedResponse(TaskDto)
  comment(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.tasks.comment(auth, id, dto);
  }
}
