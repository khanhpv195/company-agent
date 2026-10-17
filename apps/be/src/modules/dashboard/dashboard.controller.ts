import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { DashboardService } from './dashboard.service';
import { AttentionItemDto, DashboardSummaryDto } from './dto/dashboard.dto';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ResponseMessage('dashboard.LOADED')
  @ApiOperation({ summary: 'Activity of the last 14 days, open attention items, latest feed' })
  @ApiWrappedResponse(DashboardSummaryDto)
  summary(@CurrentAuth() auth: AuthContext) {
    return this.dashboard.summary(auth.workspaceId);
  }

  @Post('attention/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('dashboard.ATTENTION_RESOLVED')
  @ApiOperation({ summary: 'Resolve an attention item (a task is retried through the engine)' })
  @ApiWrappedResponse(AttentionItemDto)
  resolve(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.dashboard.resolve(auth, id);
  }
}
