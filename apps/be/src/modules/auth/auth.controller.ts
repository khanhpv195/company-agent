import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, Public, ResponseMessage } from '../../common/decorators';
import { AuthThrottlerGuard } from '../../common/guards';
import { AuthService } from './auth.service';
import { AuthResultDto, LoginDto, LogoutDto, RefreshDto, RegisterDto } from './dto/auth.dto';

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
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('auth.LOGGED_IN')
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiWrappedResponse(AuthResultDto)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('auth.REFRESHED')
  @ApiOperation({ summary: 'Rotate a refresh token for a new token pair' })
  @ApiWrappedResponse(AuthResultDto)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
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
}
