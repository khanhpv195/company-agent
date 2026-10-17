import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthStatus } from '@repo/shared';
import { Public, RawResponse } from './common/decorators';

@ApiTags('health')
@Public()
@Controller()
export class AppController {
  @Get('health')
  @RawResponse()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        uptime: { type: 'number', example: 12.34 },
      },
    },
  })
  getHealth(): HealthStatus {
    return { status: 'ok', uptime: process.uptime() };
  }
}
