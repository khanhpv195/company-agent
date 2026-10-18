import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import type {
  Assignment,
  AssignmentStatus,
  Chat,
  Message,
  MessageAuthor,
  MessageDraft,
  MessageQuote,
  MessageReaction,
  SkippedAgent,
  MessageThread,
  PostRoomMessageInput,
  Room,
  RoomIcon,
  RoomKind,
  RoomMemberRole,
  RoomTimelinePage,
  SendMessageInput,
  ThreadPage,
  Thread,
  ToolCall,
} from '@repo/shared';
import { cleanName } from '../../../common/utils';
import {
  MAX_MESSAGE_LENGTH,
  THREAD_NAME_MAX,
  TIMELINE_PAGE_DEFAULT,
  TIMELINE_PAGE_MAX,
} from '../chat.constants';

const ASSIGNMENT_STATUSES: AssignmentStatus[] = [
  'pending',
  'offered',
  'claimed',
  'running',
  'completed',
  'failed',
  'expired',
  'cancelled',
];

// ---------- responses ----------
export class ThreadDto implements Thread {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  roomId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ format: 'date-time' })
  lastMessageAt: string;

  @ApiProperty({ description: 'First line of the last message, markdown stripped' })
  preview: string;

  @ApiProperty({ description: 'Messages of others since the caller last read the thread' })
  unread: number;

  @ApiProperty({ type: String, nullable: true })
  connectionId: string | null;

  @ApiPropertyOptional({ description: 'Unread messages of others that mention the caller' })
  mentions?: number;

  @ApiPropertyOptional({ description: 'The caller read cursor (message seq) of this thread' })
  lastReadSeq?: number;

  @ApiPropertyOptional({ description: 'Seq of the last message of the thread' })
  lastSeq?: number;

  @ApiPropertyOptional({ description: 'The caller muted the thread (unread is still counted)' })
  muted?: boolean;

  @ApiPropertyOptional()
  replyCount?: number;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastReplyAt?: string | null;

  @ApiPropertyOptional({ type: [String] })
  participantIds?: string[];
}

export class RoomDto implements Room {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['dm', 'channel'] })
  kind: RoomKind;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ['users', 'sparkles', 'hourglass', 'inbox'] })
  icon: RoomIcon;

  @ApiProperty()
  isPrivate: boolean;

  @ApiProperty({ type: String, nullable: true, description: 'DM partner' })
  agentId: string | null;

  @ApiProperty({ format: 'date-time' })
  lastMessageAt: string;

  @ApiProperty()
  preview: string;

  @ApiProperty({ type: [ThreadDto] })
  threads: ThreadDto[];

  @ApiPropertyOptional({ description: 'Live human members of a channel' })
  memberCount?: number;

  @ApiPropertyOptional({ description: 'Live agents of a channel' })
  agentCount?: number;

  @ApiPropertyOptional({ description: 'The channel every new member joins (cannot be deleted)' })
  isDefault?: boolean;

  @ApiPropertyOptional({
    enum: ['owner', 'member'],
    nullable: true,
    description: 'The caller role in the channel',
  })
  myRole?: RoomMemberRole | null;

  @ApiPropertyOptional({ description: 'Main-timeline messages of others after the caller cursor' })
  unread?: number;

  @ApiPropertyOptional({ description: 'Of those, the ones mentioning the caller (or @here)' })
  mentions?: number;

  @ApiPropertyOptional({ description: 'The caller read cursor (message seq)' })
  lastReadSeq?: number;

  @ApiPropertyOptional({ description: 'The caller muted the room (unread is still counted)' })
  muted?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Agents writing a reply in this room now' })
  workingAgentIds?: string[];
}

export class ChatDto implements Chat {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['dm', 'thread'] })
  kind: 'dm' | 'thread';

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, nullable: true, description: '"# channel" for threads' })
  subtitle: string | null;

  @ApiProperty({ type: [String], description: 'Agents that can answer in this chat' })
  agentIds: string[];
}

class ToolCallDto implements ToolCall {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  input: string;

  @ApiProperty({ type: String, nullable: true })
  output: string | null;

  @ApiProperty({ enum: ['running', 'ok', 'error'] })
  status: ToolCall['status'];
}

class AssignmentDto implements Assignment {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty({ enum: ASSIGNMENT_STATUSES })
  status: AssignmentStatus;

  @ApiProperty({ type: [ToolCallDto] })
  toolCalls: ToolCallDto[];

  @ApiProperty()
  turns: number;

  @ApiProperty({ type: Number, nullable: true })
  costUsd: number | null;

  @ApiProperty({ type: String, nullable: true })
  error: string | null;
}

class MessageDraftDto implements MessageDraft {
  @ApiProperty()
  connectionId: string;

  @ApiProperty({ enum: ['pending', 'sent'] })
  state: MessageDraft['state'];
}

class MessageThreadDto implements MessageThread {
  @ApiProperty({ type: String, nullable: true })
  title: string | null;

  @ApiProperty()
  replyCount: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastReplyAt: string | null;

  @ApiProperty({ type: [String], description: 'Member and agent ids, at most 5' })
  participantIds: string[];
}

class MessageQuoteDto implements MessageQuote {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  authorName: string;

  @ApiProperty()
  excerpt: string;
}

export class SkippedAgentDto implements SkippedAgent {
  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ['offline', 'not_in_room', 'limit'] })
  reason: 'offline' | 'not_in_room' | 'limit';
}

export class MessageReactionDto implements MessageReaction {
  @ApiProperty({ description: 'The emoji' })
  key: string;

  @ApiProperty()
  count: number;

  @ApiPropertyOptional({ description: 'Whether the caller reacted (REST answers only)' })
  mine?: boolean;

  @ApiProperty({ type: [String], description: 'The first 10 reactors, oldest first' })
  memberIds: string[];
}

export class MessageDto implements Message {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Legacy chat id: the DM room id for a DM main-timeline message, otherwise the thread root id',
  })
  chatId: string;

  @ApiProperty({ format: 'uuid' })
  roomId: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Thread root; null on the main timeline',
  })
  parentId: string | null;

  @ApiProperty({ description: 'Arrival order inside the room (paging cursor)' })
  seq: number;

  @ApiProperty({
    description: '{ kind: "human" | "agent", id } or { kind: "external", connectionId, name }',
    type: 'object',
    additionalProperties: true,
  })
  author: MessageAuthor;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ enum: ['streaming', 'complete', 'failed', 'stopped'] })
  status: Message['status'];

  @ApiProperty()
  markdown: string;

  @ApiProperty({ type: AssignmentDto, nullable: true })
  assignment: AssignmentDto | null;

  @ApiProperty({ type: MessageDraftDto, nullable: true })
  draft: MessageDraftDto | null;

  @ApiProperty({ type: String, nullable: true, description: 'Roots only: the thread title' })
  threadTitle: string | null;

  @ApiPropertyOptional({ type: MessageThreadDto, description: 'Roots with a title or replies' })
  thread?: MessageThreadDto;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  editedAt: string | null;

  @ApiProperty({ description: 'Soft-deleted: markdown is empty' })
  deleted: boolean;

  @ApiProperty({ type: MessageQuoteDto, nullable: true })
  quote: MessageQuoteDto | null;

  @ApiProperty({ type: String, nullable: true })
  clientMessageId: string | null;

  @ApiPropertyOptional({
    type: [MessageReactionDto],
    description: 'Reactions grouped by emoji; `mine` only in REST answers, not in events',
  })
  reactions?: MessageReactionDto[];

  @ApiPropertyOptional({
    enum: ['queued', 'thinking', 'tool', 'writing', 'done', 'failed', 'stopped'],
    description: 'Agent replies only: what the turn is doing',
  })
  phase?: Message['phase'];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Phase `tool`: the tool in use',
  })
  activeTool?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  startedAt?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Once the run ended, in ms' })
  workedMs?: number | null;

  @ApiPropertyOptional({
    type: [SkippedAgentDto],
    description: 'Only in the answer to a send: mentioned agents that were not woken',
  })
  skippedAgents?: SkippedAgentDto[];
}

export class RoomTimelinePageDto implements RoomTimelinePage {
  @ApiProperty({ type: [MessageDto], description: 'Oldest first within the page' })
  messages: MessageDto[];

  @ApiProperty({ description: 'Older messages exist before the first one of this page' })
  hasMore: boolean;
}

export class ThreadPageDto implements ThreadPage {
  @ApiProperty({ type: MessageDto })
  root: MessageDto;

  @ApiProperty({ type: [MessageDto] })
  replies: MessageDto[];

  @ApiProperty({ description: 'More replies exist after the last one of this page' })
  hasMore: boolean;
}

export class DmChatDto {
  @ApiProperty({ format: 'uuid' })
  chatId: string;
}

// ---------- requests ----------
export class SendMessageDto implements SendMessageInput {
  @ApiProperty({ maxLength: MAX_MESSAGE_LENGTH })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(MAX_MESSAGE_LENGTH, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  markdown: string;

  @ApiPropertyOptional({ description: 'Agent to wake up; @mentions in the text are detected too' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  agentId?: string;
}

export class PostRoomMessageDto extends SendMessageDto implements PostRoomMessageInput {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Reply in the thread of this message (a reply id attaches to its root)',
  })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  parentId?: string;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: THREAD_NAME_MAX,
    description: 'Only without parentId: starts a titled thread',
  })
  @IsOptional()
  @Transform(cleanName)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(THREAD_NAME_MAX, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  threadTitle?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  quoteMessageId?: string;

  @ApiPropertyOptional({ maxLength: 100, description: 'Idempotency key per (room, author)' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(100, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  clientMessageId?: string;
}

export class EditMessageDto {
  @ApiProperty({ maxLength: MAX_MESSAGE_LENGTH })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(MAX_MESSAGE_LENGTH, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  markdown: string;
}

export class RenameThreadDto {
  @ApiProperty({ minLength: 1, maxLength: THREAD_NAME_MAX })
  @Transform(cleanName)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(THREAD_NAME_MAX, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  title: string;
}

const SEQ_PATTERN = /^\d{1,18}$/;

export class TimelineQueryDto {
  @ApiPropertyOptional({
    description: 'Only messages with a smaller seq (the `seq` of the oldest one loaded)',
  })
  @IsOptional()
  @Matches(SEQ_PATTERN, { message: i18nValidationMessage('validation.IS_INT') })
  beforeSeq?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: TIMELINE_PAGE_MAX, default: TIMELINE_PAGE_DEFAULT })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  @Max(TIMELINE_PAGE_MAX, { message: i18nValidationMessage('validation.MAX') })
  limit: number = TIMELINE_PAGE_DEFAULT;
}

export class ThreadQueryDto {
  @ApiPropertyOptional({
    description: 'Only replies with a greater seq (the `seq` of the last one loaded)',
  })
  @IsOptional()
  @Matches(SEQ_PATTERN, { message: i18nValidationMessage('validation.IS_INT') })
  afterSeq?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: TIMELINE_PAGE_MAX, default: TIMELINE_PAGE_DEFAULT })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  @Max(TIMELINE_PAGE_MAX, { message: i18nValidationMessage('validation.MAX') })
  limit: number = TIMELINE_PAGE_DEFAULT;
}
