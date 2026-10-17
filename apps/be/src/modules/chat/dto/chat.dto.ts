import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import type {
  Assignment,
  AssignmentStatus,
  Chat,
  Message,
  MessageAuthor,
  MessageDraft,
  Room,
  RoomIcon,
  RoomKind,
  RoomMemberRole,
  SendMessageInput,
  Thread,
  ToolCall,
} from '@repo/shared';
import { MAX_MESSAGE_LENGTH } from '../chat.constants';

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

export class MessageDto implements Message {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chatId: string;

  @ApiProperty({
    description: '{ kind: "human" | "agent", id } or { kind: "external", connectionId, name }',
    type: 'object',
    additionalProperties: true,
  })
  author: MessageAuthor;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ enum: ['streaming', 'complete', 'failed'] })
  status: Message['status'];

  @ApiProperty()
  markdown: string;

  @ApiProperty({ type: AssignmentDto, nullable: true })
  assignment: AssignmentDto | null;

  @ApiProperty({ type: MessageDraftDto, nullable: true })
  draft: MessageDraftDto | null;
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
