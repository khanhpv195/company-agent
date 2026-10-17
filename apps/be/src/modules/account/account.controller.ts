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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import { MemberThrottlerGuard } from '../../common/guards';
import type { AuthContext } from '../../common/types';
import { SessionDto } from '../workspace/dto/workspace.dto';
import { AccountService } from './account.service';
import {
  AuthSessionInfoDto,
  ChangePasswordDto,
  DeleteAccountDto,
  UpdateProfileDto,
} from './dto/account.dto';

/** The caller's own account; open to every authenticated member. */
@ApiTags('account')
@ApiBearerAuth()
@Controller('me')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Patch()
  @ResponseMessage('account.PROFILE_UPDATED')
  @ApiOperation({ summary: 'Update the caller name and avatar color' })
  @ApiWrappedResponse(SessionDto)
  updateProfile(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateProfileDto) {
    return this.account.updateProfile(auth, dto);
  }

  @Post('password')
  @UseGuards(MemberThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('account.PASSWORD_CHANGED')
  @ApiOperation({ summary: 'Change the password; signs out every other session' })
  @ApiWrappedResponse(null)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ChangePasswordDto,
  ): Promise<null> {
    await this.account.changePassword(auth, dto);
    return null;
  }

  @Get('sessions')
  @ResponseMessage('account.SESSIONS_LISTED')
  @ApiOperation({ summary: 'Live logins of the caller' })
  @ApiWrappedResponse(AuthSessionInfoDto, HttpStatus.OK, { isArray: true })
  sessions(@CurrentAuth() auth: AuthContext) {
    return this.account.listSessions(auth);
  }

  // Declared before `sessions/:id` so the literal path is never read as an id.
  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('account.SESSIONS_REVOKED')
  @ApiOperation({ summary: 'Sign out every session except the current one' })
  @ApiWrappedResponse(null)
  async revokeOthers(@CurrentAuth() auth: AuthContext): Promise<null> {
    await this.account.revokeOtherSessions(auth);
    return null;
  }

  @Delete('sessions/:id')
  @ResponseMessage('account.SESSION_REVOKED')
  @ApiOperation({ summary: 'Sign out one session of the caller' })
  @ApiWrappedResponse(null)
  async revokeSession(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<null> {
    await this.account.revokeSession(auth, id);
    return null;
  }

  @Post('verify-email/resend')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('account.VERIFY_EMAIL_SENT')
  @ApiOperation({ summary: 'Send the verification email again (once per minute)' })
  @ApiWrappedResponse(null)
  async resendVerification(@CurrentAuth() auth: AuthContext): Promise<null> {
    await this.account.resendVerification(auth);
    return null;
  }

  @Delete()
  @UseGuards(MemberThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('account.DELETED')
  @ApiOperation({ summary: 'Delete the caller account (not allowed for the owner)' })
  @ApiWrappedResponse(null)
  async deleteAccount(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: DeleteAccountDto,
  ): Promise<null> {
    await this.account.deleteAccount(auth, dto);
    return null;
  }
}
