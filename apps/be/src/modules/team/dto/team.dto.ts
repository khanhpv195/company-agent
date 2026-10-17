import { ApiProperty } from '@nestjs/swagger';
import type {
  AcceptInviteInput,
  AssignableRole,
  CreateInviteInput,
  CreateInviteResult,
  DeleteWorkspaceInput,
  Invite as InviteContract,
  InvitePreview,
  TransferOwnershipInput,
  UpdateMemberRoleInput,
  UpdateWorkspaceInput,
} from '@repo/shared';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { cleanName } from '../../../common/utils';
import { IsStrongPassword } from '../../../common/validators';

export const ASSIGNABLE_ROLES: AssignableRole[] = ['admin', 'member'];
export const TEAM_NAME_MAX = 60;
export const WORKSPACE_NAME_MAX = 80;

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class InviteDto implements InviteContract {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'bob@example.com' })
  email: string;

  @ApiProperty({ enum: ASSIGNABLE_ROLES })
  role: AssignableRole;

  @ApiProperty({ type: String, nullable: true })
  invitedByName: string | null;

  @ApiProperty({ description: 'ISO timestamp' })
  createdAt: string;

  @ApiProperty({ description: 'ISO timestamp' })
  expiresAt: string;
}

export class CreateInviteDto implements CreateInviteInput {
  @ApiProperty({ example: 'bob@example.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
  @MaxLength(254, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  email: string;

  @ApiProperty({ enum: ASSIGNABLE_ROLES })
  @IsIn(ASSIGNABLE_ROLES, { message: i18nValidationMessage('validation.IS_ENUM') })
  role: AssignableRole;
}

export class CreateInviteResultDto implements CreateInviteResult {
  @ApiProperty({ type: InviteDto })
  invite: InviteDto;

  @ApiProperty({ description: 'Raw invite token; shown once' })
  token: string;

  @ApiProperty({ description: 'Link that opens the accept screen; shown once' })
  url: string;
}

export class InvitePreviewDto implements InvitePreview {
  @ApiProperty()
  workspaceName: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: ASSIGNABLE_ROLES })
  role: AssignableRole;

  @ApiProperty({ type: String, nullable: true })
  invitedByName: string | null;

  @ApiProperty({ description: 'ISO timestamp' })
  expiresAt: string;
}

export class InvitePreviewQueryDto {
  @ApiProperty({ description: 'The invite token' })
  @Transform(trim)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(512, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  token: string;
}

export class AcceptInviteDto implements AcceptInviteInput {
  @ApiProperty({ description: 'The invite token' })
  @Transform(trim)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(512, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  token: string;

  @ApiProperty({ example: 'Bob', maxLength: TEAM_NAME_MAX })
  @Transform(cleanName)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(TEAM_NAME_MAX, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsStrongPassword()
  password: string;

  @ApiProperty({ description: 'Must be true: the terms of service were accepted' })
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  @Equals(true, { message: i18nValidationMessage('validation.MUST_ACCEPT_TERMS') })
  acceptTerms: boolean;
}

export class UpdateMemberRoleDto implements UpdateMemberRoleInput {
  @ApiProperty({ enum: ASSIGNABLE_ROLES })
  @IsIn(ASSIGNABLE_ROLES, { message: i18nValidationMessage('validation.IS_ENUM') })
  role: AssignableRole;
}

export class TransferOwnershipDto implements TransferOwnershipInput {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: i18nValidationMessage('validation.IS_UUID') })
  memberId: string;

  @ApiProperty()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(128, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  password: string;
}

export class UpdateWorkspaceDto implements UpdateWorkspaceInput {
  @ApiProperty({ minLength: 1, maxLength: WORKSPACE_NAME_MAX })
  @Transform(cleanName)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(WORKSPACE_NAME_MAX, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name: string;
}

export class DeleteWorkspaceDto implements DeleteWorkspaceInput {
  @ApiProperty()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(128, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  password: string;

  @ApiProperty({ description: 'Must equal the workspace name' })
  @Transform(cleanName)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(WORKSPACE_NAME_MAX, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  confirmName: string;
}
