import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { RunSpanDto } from './dto/task.dto';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('run-spans')
export class RunSpansController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ResponseMessage('tasks.SPANS_LISTED')
  @ApiOperation({ summary: 'Finished runs for the agent timeline' })
  @ApiQuery({ name: 'since', required: false, description: 'ISO time; only runs ended after it' })
  @ApiWrappedResponse(RunSpanDto, HttpStatus.OK, { isArray: true })
  list(@CurrentAuth() auth: AuthContext, @Query('since') since?: string) {
    return this.tasks.spans(auth, since);
  }
}
