import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiWrappedResponse,
  Public,
  ReqMeta,
  RequestMeta,
  ResponseMessage,
} from '../../common/decorators';
import { AuthThrottlerGuard } from '../../common/guards';
import { AuthService } from './auth.service';
import {
  AuthResultDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Public()
@UseGuards(AuthThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ResponseMessage('auth.REGISTERED')
  @ApiOperation({ summary: 'Create an account with its own workspace (owner)' })
  @ApiWrappedResponse(AuthResultDto, HttpStatus.CREATED)
  register(@Body() dto: RegisterDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.register(dto, meta);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('auth.LOGGED_IN')
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiWrappedResponse(AuthResultDto)
  login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.login(dto, meta);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('auth.REFRESHED')
  @ApiOperation({ summary: 'Rotate a refresh token for a new token pair' })
  @ApiWrappedResponse(AuthResultDto)
  refresh(@Body() dto: RefreshDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.refresh(dto.refreshToken, meta);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('auth.LOGGED_OUT')
  @ApiOperation({ summary: 'Revoke the refresh token family; always succeeds' })
  @ApiWrappedResponse(null)
  async logout(@Body() dto: LogoutDto): Promise<null> {
    await this.auth.logout(dto.refreshToken);
    return null;
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('auth.FORGOT_PASSWORD_SENT')
  @ApiOperation({ summary: 'Email a reset token; answers the same for unknown emails' })
  @ApiWrappedResponse(null)
  forgotPassword(@Body() dto: ForgotPasswordDto): null {
    this.auth.forgotPassword(dto);
    return null;
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('auth.PASSWORD_RESET')
  @ApiOperation({ summary: 'Set a new password with an emailed token; signs out every session' })
  @ApiWrappedResponse(null)
  async resetPassword(@Body() dto: ResetPasswordDto, @ReqMeta() meta: RequestMeta): Promise<null> {
    await this.auth.resetPassword(dto, meta);
    return null;
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('auth.EMAIL_VERIFIED')
  @ApiOperation({ summary: 'Confirm the email address with an emailed token' })
  @ApiWrappedResponse(null)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<null> {
    await this.auth.verifyEmail(dto);
    return null;
  }
}
