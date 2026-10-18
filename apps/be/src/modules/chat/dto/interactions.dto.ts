import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import type {
  CreatePinInput,
  MentionFeedPage,
  MentionItem,
  MuteState,
  PinItem,
  PinTargetType,
  PresenceEntry,
  PresenceStatus,
  ReadState,
  ReorderPinsInput,
  ThreadFilter,
} from '@repo/shared';
import {
  MAX_PINS,
  MENTIONS_PAGE_DEFAULT,
  MENTIONS_PAGE_MAX,
  THREAD_LIST_DEFAULT,
  THREAD_LIST_MAX,
} from '../chat.constants';
import { MessageDto } from './chat.dto';

// ---------- responses ----------
export class ReadStateDto implements ReadState {
  @ApiProperty({ format: 'uuid' })
  roomId: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Null for the main timeline',
  })
  rootId: string | null;

  @ApiProperty()
  lastReadSeq: number;

  @ApiProperty()
  unread: number;

  @ApiProperty()
  mentions: number;
}

export class MuteStateDto implements MuteState {
  @ApiProperty({ format: 'uuid' })
  roomId: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  rootId: string | null;

  @ApiProperty()
  muted: boolean;
}

export class PinItemDto implements PinItem {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['room', 'thread', 'message'] })
  targetType: PinTargetType;

  @ApiProperty({ format: 'uuid' })
  targetId: string;

  @ApiProperty({ format: 'uuid' })
  roomId: string;

  @ApiProperty()
  roomName: string;

  @ApiProperty({ enum: ['dm', 'channel'] })
  roomKind: 'dm' | 'channel';

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, nullable: true })
  messageId: string | null;

  @ApiProperty({ type: String, nullable: true })
  threadRootId: string | null;

  @ApiProperty()
  position: number;
}

export class MentionItemDto implements MentionItem {
  @ApiProperty({ type: MessageDto })
  message: MessageDto;

  @ApiProperty({ format: 'uuid' })
  roomId: string;

  @ApiProperty()
  roomName: string;

  @ApiProperty({ enum: ['dm', 'channel'] })
  roomKind: 'dm' | 'channel';

  @ApiProperty({ type: String, nullable: true })
  threadRootId: string | null;

  @ApiProperty({ type: String, nullable: true })
  threadTitle: string | null;
}

export class MentionFeedPageDto implements MentionFeedPage {
  @ApiProperty({ type: [MentionItemDto], description: 'Newest first' })
  items: MentionItemDto[];

  @ApiProperty()
  hasMore: boolean;
}

export class PresenceEntryDto implements PresenceEntry {
  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty({ enum: ['online', 'idle', 'offline'] })
  status: PresenceStatus;
}

// ---------- requests ----------
const SEQ_PATTERN = /^\d{1,18}$/;

export class ReadDto {
  @ApiProperty({ minimum: 0, description: 'Read through this message seq (never moves backwards)' })
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_ENUMT') })
  @Min(0, { message: i18nValidationMessage('validation.MIN') })
  seq: number;
}

export class UnreadDto {
  @ApiProperty({ minimum: 1, description: 'This message and everything after it become unread' })
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_ENUMT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  throughSeq: number;
}

export class TypingDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Typing in the thread of this message' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  parentId?: string;
}

export class ThreadListQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'unread', 'mentioned', 'mine'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'unread', 'mentioned', 'mine'], {
    message: i18nValidationMessage('validation.IS_ENUM'),
  })
  filter: ThreadFilter = 'all';

  @ApiPropertyOptional({ minimum: 1, maximum: THREAD_LIST_MAX, default: THREAD_LIST_DEFAULT })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_ENUMT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  @Max(THREAD_LIST_MAX, { message: i18nValidationMessage('validation.MAX') })
  limit: number = THREAD_LIST_DEFAULT;
}

export class MentionsQueryDto {
  @ApiPropertyOptional({ description: 'Only messages with a smaller seq (the last one loaded)' })
  @IsOptional()
  @Matches(SEQ_PATTERN, { message: i18nValidationMessage('validation.IS_ENUMT') })
  before?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MENTIONS_PAGE_MAX, default: MENTIONS_PAGE_DEFAULT })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_ENUMT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  @Max(MENTIONS_PAGE_MAX, { message: i18nValidationMessage('validation.MAX') })
  limit: number = MENTIONS_PAGE_DEFAULT;
}

export class CreatePinDto implements CreatePinInput {
  @ApiProperty({ enum: ['room', 'thread', 'message'] })
  @IsIn(['room', 'thread', 'message'], { message: i18nValidationMessage('validation.IS_ENUM') })
  targetType: PinTargetType;

  @ApiProperty({ format: 'uuid', description: 'Room id, thread root message id or message id' })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  targetId: string;
}

export class ReorderPinsDto implements ReorderPinsInput {
  @ApiProperty({ type: [String], description: 'Pin ids, first = top; unlisted pins follow' })
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ArrayMaxSize(MAX_PINS, { message: i18nValidationMessage('validation.MAX') })
  @IsString({ each: true, message: i18nValidationMessage('validation.IS_STRING') })
  ids: string[];
}

export class PresenceStatusDto {
  @ApiProperty({ enum: ['online', 'idle'] })
  @IsIn(['online', 'idle'], { message: i18nValidationMessage('validation.IS_ENUM') })
  status: 'online' | 'idle';
}
