import { Controller, Get, Logger, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { HealthStatus, ReadinessStatus } from '@repo/shared';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { Public, RawResponse } from './common/decorators';

@ApiTags('health')
@Public()
@RawResponse()
@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness probe (the process is up; does not touch the database)' })
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

  @Get('health/ready')
  @ApiOperation({ summary: 'Readiness probe: 200 while the database answers, else 503' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        db: { type: 'string', example: 'up' },
      },
    },
  })
  @ApiServiceUnavailableResponse({ description: 'The database does not answer' })
  async getReady(@Res({ passthrough: true }) res: Response): Promise<ReadinessStatus> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', db: 'up' };
    } catch (error) {
      this.logger.error(`Readiness check failed: ${String(error)}`);
      res.status(503);
      return { status: 'unavailable', db: 'down' };
    }
  }
}
