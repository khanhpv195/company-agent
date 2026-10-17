import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiWrappedResponse,
  CurrentComputer,
  Public,
  ResponseMessage,
} from '../../common/decorators';
import { AuthThrottlerGuard, GatewayThrottlerGuard } from '../../common/guards';
import type { ComputerContext } from '../../common/types';
import { ComputerAuthGuard } from './computer-auth.guard';
import { DaemonGatewayService } from './daemon-gateway.service';
import {
  AttemptDto,
  ClaimDto,
  HeartbeatDto,
  PairDto,
  PairResultDto,
  ProgressDto,
  ResultDto,
} from './dto/daemon.dto';
import { GatewayToolsService } from './gateway-tools.service';
import { PairingService } from './pairing.service';

/** The one public gateway route: a daemon exchanging a pairing code for its API key. */
@ApiTags('gateway')
@Public()
@Controller('gateway')
export class GatewayPairController {
  constructor(private readonly pairing: PairingService) {}

  @Post('pair')
  @UseGuards(AuthThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('gateway.PAIRED')
  @ApiOperation({ summary: 'Exchange a pairing code for a computer and its API key (daemon)' })
  @ApiWrappedResponse(PairResultDto)
  pair(@Body() dto: PairDto) {
    return this.pairing.pair(dto);
  }
}

/**
 * What a paired daemon calls, authenticated by its computer API key (`Authorization: Bearer
 * agk_...`). `@Public()` only skips the member JWT guard; `ComputerAuthGuard` does the real check.
 */
@ApiTags('gateway')
@ApiBearerAuth()
@Public()
@UseGuards(ComputerAuthGuard, GatewayThrottlerGuard)
@Controller('gateway')
export class GatewayController {
  constructor(
    private readonly daemon: DaemonGatewayService,
    private readonly tools: GatewayToolsService,
  ) {}

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('gateway.HEARTBEAT')
  @ApiOperation({ summary: 'Mark the computer online and list its agents' })
  heartbeat(@CurrentComputer() computer: ComputerContext, @Body() dto: HeartbeatDto) {
    return this.daemon.heartbeat(computer, dto);
  }

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('gateway.CLAIMED')
  @ApiOperation({ summary: 'Claim the oldest offered assignment of this computer, or null' })
  claim(@CurrentComputer() computer: ComputerContext, @Body() dto: ClaimDto) {
    return this.daemon.claim(computer, dto);
  }

  @Post('assignments/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('gateway.ACCEPTED')
  @ApiOperation({ summary: 'claimed -> running' })
  accept(
    @CurrentComputer() computer: ComputerContext,
    @Param('id') id: string,
    @Body() dto: AttemptDto,
  ) {
    return this.daemon.accept(computer, id, dto.attempt);
  }

  @Post('assignments/:id/heartbeat')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('gateway.HEARTBEAT')
  @ApiOperation({ summary: 'Renew the lease; `cancelled: true` tells the daemon to stop' })
  assignmentHeartbeat(
    @CurrentComputer() computer: ComputerContext,
    @Param('id') id: string,
    @Body() dto: AttemptDto,
  ) {
    return this.daemon.assignmentHeartbeat(computer, id, dto.attempt);
  }

  @Post('assignments/:id/progress')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('gateway.PROGRESS')
  @ApiOperation({ summary: 'Streamed text, tool calls and turns of a running assignment' })
  progress(
    @CurrentComputer() computer: ComputerContext,
    @Param('id') id: string,
    @Body() dto: ProgressDto,
  ) {
    return this.daemon.progress(computer, id, dto);
  }

  @Post('assignments/:id/result')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('gateway.RESULT')
  @ApiOperation({ summary: 'Final outcome of an assignment; repeating it is a no-op' })
  result(
    @CurrentComputer() computer: ComputerContext,
    @Param('id') id: string,
    @Body() dto: ResultDto,
  ) {
    return this.daemon.result(computer, id, dto);
  }

  @Post('tools/:name')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('gateway.TOOL_DONE')
  @ApiOperation({
    summary: 'Run a workspace tool as the member the assignment acts for (X-Assignment-Id)',
  })
  tool(
    @CurrentComputer() computer: ComputerContext,
    @Param('name') name: string,
    @Headers('x-assignment-id') assignmentId: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tools.execute(computer, assignmentId ?? '', name, body);
  }
}
