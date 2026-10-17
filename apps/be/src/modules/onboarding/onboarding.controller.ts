import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { CliStatus } from '@repo/shared';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { SessionDto } from '../workspace/dto/workspace.dto';
import { OnboardingService } from './onboarding.service';

class CliStatusDto implements CliStatus {
  @ApiProperty()
  connected: boolean;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  computerId: string | null;
}

@ApiTags('onboarding')
@ApiBearerAuth()
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('cli-status')
  @ResponseMessage('onboarding.CLI_STATUS_LOADED')
  @ApiOperation({ summary: 'Whether a computer with the CLI is connected to the workspace' })
  @ApiWrappedResponse(CliStatusDto)
  cliStatus(@CurrentAuth() auth: AuthContext) {
    return this.onboarding.cliStatus(auth);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('onboarding.COMPLETED')
  @ApiOperation({ summary: 'Marks the workspace onboarded (idempotent)' })
  @ApiWrappedResponse(SessionDto)
  complete(@CurrentAuth() auth: AuthContext) {
    return this.onboarding.complete(auth);
  }
}
