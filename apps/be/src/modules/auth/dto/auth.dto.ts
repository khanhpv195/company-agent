import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import type {
  AuthResult,
  LoginInput,
  LogoutInput,
  RefreshInput,
  RegisterInput,
} from '@repo/shared';
import { SessionDto } from '../../workspace/dto/workspace.dto';

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class LoginDto implements LoginInput {
  @ApiProperty({ example: 'khanh@example.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
  email: string;

  @ApiProperty()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(128, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  password: string;
}

export class RegisterDto implements RegisterInput {
  @ApiProperty({ example: 'Khanh', maxLength: 80 })
  @Transform(trim)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(80, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name: string;

  @ApiProperty({ example: 'khanh@example.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
  email: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MinLength(8, { message: i18nValidationMessage('validation.MIN_LENGTH') })
  @MaxLength(128, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  password: string;

  @ApiPropertyOptional({ example: 'Khanh workspace', maxLength: 80 })
  @Transform(trim)
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(80, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  workspaceName?: string;
}

export class RefreshDto implements RefreshInput {
  @ApiProperty()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(512, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  refreshToken: string;
}

export class LogoutDto implements LogoutInput {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(512, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  refreshToken?: string;
}

export class AuthResultDto implements AuthResult {
  @ApiProperty({ type: SessionDto })
  session: SessionDto;

  @ApiProperty({ description: 'JWT, send as `Authorization: Bearer <token>`' })
  accessToken: string;

  @ApiProperty({ description: 'Opaque, single use; rotate via POST /auth/refresh' })
  refreshToken: string;
}
