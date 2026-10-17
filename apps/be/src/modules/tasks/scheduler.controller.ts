import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, Roles, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { SchedulerStateDto } from './dto/task.dto';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ResponseMessage('tasks.SCHEDULER_LOADED')
  @ApiOperation({ summary: 'Whether agents are paused' })
  @ApiWrappedResponse(SchedulerStateDto)
  get(@CurrentAuth() auth: AuthContext) {
    return this.tasks.scheduler(auth);
  }

  @Put()
  @Roles('owner', 'admin')
  @ResponseMessage('tasks.SCHEDULER_UPDATED')
  @ApiOperation({ summary: 'Pause or resume agents (resuming makes idle agents pick up work)' })
  @ApiWrappedResponse(SchedulerStateDto)
  set(@CurrentAuth() auth: AuthContext, @Body() dto: SchedulerStateDto) {
    return this.tasks.setScheduler(auth, dto.paused);
  }
}
