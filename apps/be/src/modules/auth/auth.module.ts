import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { TokenService } from './token.service';

@Module({
  imports: [TypeOrmModule.forFeature([RefreshToken]), WorkspaceModule],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
})
export class AuthModule {}
