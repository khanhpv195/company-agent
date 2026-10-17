import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import type {
  AuthResult,
  ForgotPasswordInput,
  LoginInput,
  LogoutInput,
  RefreshInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from '@repo/shared';
import { cleanName } from '../../../common/utils';
import { IsStrongPassword } from '../../../common/validators';
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
  @Transform(cleanName)
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
  @IsStrongPassword()
  password: string;

  @ApiPropertyOptional({ example: 'Khanh workspace', maxLength: 80 })
  @Transform(cleanName)
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(80, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  workspaceName?: string;

  @ApiProperty({ description: 'Must be true: the terms of service were accepted' })
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  @Equals(true, { message: i18nValidationMessage('validation.MUST_ACCEPT_TERMS') })
  acceptTerms: boolean;
}

export class ForgotPasswordDto implements ForgotPasswordInput {
  @ApiProperty({ example: 'khanh@example.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
  email: string;
}

export class ResetPasswordDto implements ResetPasswordInput {
  @ApiProperty({ description: 'The token from the reset email' })
  @Transform(trim)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(512, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  token: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsStrongPassword()
  newPassword: string;
}

export class VerifyEmailDto implements VerifyEmailInput {
  @ApiProperty({ description: 'The token from the verification email' })
  @Transform(trim)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(512, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  token: string;
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
