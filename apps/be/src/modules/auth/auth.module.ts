import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountToken } from '../account/entities/account-token.entity';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AccountTokenService } from './account-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { LoginAttemptService } from './login-attempt.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Module({
  imports: [TypeOrmModule.forFeature([RefreshToken, AccountToken]), WorkspaceModule],
  controllers: [AuthController],
  providers: [AuthService, TokenService, AccountTokenService, SessionService, LoginAttemptService],
  exports: [AccountTokenService, SessionService, TokenService, LoginAttemptService],
})
export class AuthModule {}
