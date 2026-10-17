import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  AuthSessionInfo,
  ChangePasswordInput,
  DeleteAccountInput,
  UpdateProfileInput,
} from '@repo/shared';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { cleanName } from '../../../common/utils';
import { IsStrongPassword } from '../../../common/validators';

export const PROFILE_NAME_MAX = 60;

export class UpdateProfileDto implements UpdateProfileInput {
  @ApiPropertyOptional({ minLength: 1, maxLength: PROFILE_NAME_MAX })
  @Transform(cleanName)
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MinLength(1, { message: i18nValidationMessage('validation.MIN_LENGTH') })
  @MaxLength(PROFILE_NAME_MAX, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '#b0516f',
    description: '`#rrggbb`, or null for the default avatar color',
  })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: i18nValidationMessage('validation.IS_HEX_COLOR') })
  color?: string | null;
}

export class ChangePasswordDto implements ChangePasswordInput {
  @ApiProperty()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(128, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  currentPassword: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsStrongPassword()
  newPassword: string;
}

export class DeleteAccountDto implements DeleteAccountInput {
  @ApiProperty()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(128, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  password: string;
}

export class AuthSessionInfoDto implements AuthSessionInfo {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  lastUsedAt: string;

  @ApiProperty({ type: String, nullable: true })
  userAgent: string | null;

  @ApiProperty({ type: String, nullable: true })
  ip: string | null;

  @ApiProperty()
  current: boolean;
}
