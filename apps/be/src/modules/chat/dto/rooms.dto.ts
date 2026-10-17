import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import type {
  AddRoomMembersInput,
  BrowseRoom,
  CreateRoomInput,
  CreateThreadInput,
  RoomAgent,
  RoomIcon,
  RoomMember,
  RoomMemberRole,
  RoomMembers,
  UpdateRoomInput,
} from '@repo/shared';
import { cleanName } from '../../../common/utils';
import { MAX_MESSAGE_LENGTH, ROOM_NAME_MAX, THREAD_NAME_MAX } from '../chat.constants';

// ---------- responses ----------
export class RoomMemberDto implements RoomMember {
  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  color: string | null;

  @ApiProperty({ enum: ['owner', 'member'] })
  role: RoomMemberRole;

  @ApiProperty({ format: 'date-time' })
  joinedAt: string;
}

export class RoomAgentDto implements RoomAgent {
  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  avatar: number;

  @ApiProperty({ format: 'date-time' })
  joinedAt: string;
}

export class RoomMembersDto implements RoomMembers {
  @ApiProperty({ type: [RoomMemberDto] })
  members: RoomMemberDto[];

  @ApiProperty({ type: [RoomAgentDto] })
  agents: RoomAgentDto[];
}

export class BrowseRoomDto implements BrowseRoom {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ['users', 'sparkles', 'hourglass', 'inbox'] })
  icon: RoomIcon;

  @ApiProperty()
  memberCount: number;

  @ApiProperty()
  agentCount: number;
}

// ---------- requests ----------
const ids = () => IsString({ each: true, message: i18nValidationMessage('validation.IS_STRING') });

export class CreateRoomDto implements CreateRoomInput {
  @ApiProperty({ minLength: 1, maxLength: ROOM_NAME_MAX })
  @Transform(cleanName)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(ROOM_NAME_MAX, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  isPrivate?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Members to add (the creator joins anyway)' })
  @IsOptional()
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ids()
  memberIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ids()
  agentIds?: string[];
}

export class UpdateRoomDto implements UpdateRoomInput {
  @ApiPropertyOptional({ minLength: 1, maxLength: ROOM_NAME_MAX })
  @IsOptional()
  @Transform(cleanName)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(ROOM_NAME_MAX, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  isPrivate?: boolean;
}

export class AddRoomMembersDto implements AddRoomMembersInput {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ids()
  memberIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ids()
  agentIds?: string[];
}

export class CreateThreadDto implements CreateThreadInput {
  @ApiProperty({ minLength: 1, maxLength: THREAD_NAME_MAX })
  @Transform(cleanName)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(THREAD_NAME_MAX, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name: string;

  @ApiPropertyOptional({ maxLength: MAX_MESSAGE_LENGTH })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(MAX_MESSAGE_LENGTH, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  message?: string;
}
