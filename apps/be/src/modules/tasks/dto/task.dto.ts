import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import type {
  CommentInput,
  CreateTaskInput,
  MoveTaskInput,
  RunSpan,
  SchedulerState,
  Task,
  TaskActiveRun,
  TaskActivity,
  TaskPriority,
  TaskRun,
  TaskRunStatus,
  TaskStatus,
  TaskStep,
  TaskSubtask,
  UpdateTaskInput,
} from '@repo/shared';
import { MAX_TEXT_LENGTH, MAX_TITLE_LENGTH } from '../task-constants';

export const TASK_STATUSES: TaskStatus[] = ['backlog', 'todo', 'doing', 'review', 'done'];
export const TASK_PRIORITIES: TaskPriority[] = ['urgent', 'high', 'med', 'low'];
const MAX_SUBTASKS = 200;

const isString = { message: i18nValidationMessage('validation.IS_STRING') };
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// ---------- responses ----------
export class TaskSubtaskDto implements TaskSubtask {
  @ApiProperty()
  @IsString(isString)
  @MaxLength(MAX_TITLE_LENGTH, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  title: string;

  @ApiProperty()
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  done: boolean;
}

class TaskStepDto implements TaskStep {
  @ApiProperty()
  tool: string;

  @ApiProperty()
  input: string;
}

class TaskActiveRunDto implements TaskActiveRun {
  @ApiProperty()
  n: number;

  @ApiProperty({ format: 'date-time' })
  startedAt: string;

  @ApiProperty()
  step: number;

  @ApiProperty({ type: [TaskStepDto] })
  steps: TaskStepDto[];

  @ApiProperty({ format: 'uuid' })
  computerId: string;
}

class TaskRunDto implements TaskRun {
  @ApiProperty()
  n: number;

  @ApiProperty({ enum: ['completed', 'failed', 'cancelled', 'expired'] })
  status: TaskRunStatus;

  @ApiProperty()
  durationSec: number;

  @ApiProperty()
  toolCalls: number;

  @ApiProperty({ type: Number, nullable: true })
  costUsd: number | null;

  @ApiProperty({ format: 'date-time' })
  at: string;

  @ApiProperty({ type: String, nullable: true })
  error: string | null;
}

class TaskActivityDto implements TaskActivity {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, nullable: true, description: 'Member or agent id; null = system' })
  by: string | null;

  @ApiProperty({ format: 'date-time' })
  at: string;

  @ApiProperty({ enum: ['event', 'comment'] })
  kind: 'event' | 'comment';

  @ApiProperty({ description: 'Inline markdown' })
  text: string;

  @ApiProperty({ enum: ['normal', 'error'] })
  tone: 'normal' | 'error';
}

export class TaskDto implements Task {
  @ApiProperty({ example: 'AG-31' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ enum: TASK_STATUSES })
  status: TaskStatus;

  @ApiProperty({ type: String, nullable: true, description: 'Agent or member id' })
  assigneeId: string | null;

  @ApiProperty({ enum: TASK_PRIORITIES })
  priority: TaskPriority;

  @ApiProperty({ type: [String] })
  labels: string[];

  @ApiProperty({ type: String, nullable: true })
  chatId: string | null;

  @ApiProperty()
  requiresReview: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: [TaskSubtaskDto] })
  subtasks: TaskSubtaskDto[];

  @ApiProperty({ type: [TaskRunDto], description: 'Finished runs, newest first' })
  runs: TaskRunDto[];

  @ApiProperty({ type: TaskActiveRunDto, nullable: true })
  activeRun: TaskActiveRunDto | null;

  @ApiProperty({ type: [TaskActivityDto], description: 'Oldest first' })
  activity: TaskActivityDto[];

  @ApiProperty({ type: String, nullable: true })
  output: string | null;

  @ApiProperty({ type: String, nullable: true })
  blockedReason: string | null;

  @ApiProperty({ type: String, nullable: true })
  error: string | null;

  @ApiProperty({ description: 'Manual order inside a column' })
  rank: number;
}

export class RunSpanDto implements RunSpan {
  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ format: 'date-time' })
  startedAt: string;

  @ApiProperty({ format: 'date-time' })
  endedAt: string;

  @ApiProperty({ enum: ['done', 'fail', 'cancel'] })
  result: RunSpan['result'];
}

// ---------- requests ----------
export class CreateTaskDto implements CreateTaskInput {
  @ApiProperty({ maxLength: MAX_TITLE_LENGTH })
  @Transform(trim)
  @IsString(isString)
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(MAX_TITLE_LENGTH, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  title: string;

  @ApiPropertyOptional({ maxLength: MAX_TEXT_LENGTH })
  @IsOptional()
  @IsString(isString)
  @MaxLength(MAX_TEXT_LENGTH, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  description?: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Agent or member id' })
  @IsOptional()
  @IsString(isString)
  assigneeId?: string | null;

  @ApiPropertyOptional({ enum: TASK_PRIORITIES })
  @IsOptional()
  @IsIn(TASK_PRIORITIES, { message: i18nValidationMessage('validation.IS_ENUM') })
  priority?: TaskPriority;

  @ApiPropertyOptional({ enum: TASK_STATUSES })
  @IsOptional()
  @IsIn(TASK_STATUSES, { message: i18nValidationMessage('validation.IS_ENUM') })
  status?: TaskStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  requiresReview?: boolean;
}

export class UpdateTaskDto implements UpdateTaskInput {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Agent or member id' })
  @IsOptional()
  @IsString(isString)
  assigneeId?: string | null;

  @ApiPropertyOptional({ enum: TASK_PRIORITIES })
  @IsOptional()
  @IsIn(TASK_PRIORITIES, { message: i18nValidationMessage('validation.IS_ENUM') })
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  requiresReview?: boolean;

  @ApiPropertyOptional({ type: [TaskSubtaskDto], description: 'Replaces the checklist' })
  @IsOptional()
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ArrayMaxSize(MAX_SUBTASKS, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  @ValidateNested({ each: true })
  @Type(() => TaskSubtaskDto)
  subtasks?: TaskSubtaskDto[];
}

export class MoveTaskDto implements MoveTaskInput {
  @ApiProperty({ enum: TASK_STATUSES })
  @IsIn(TASK_STATUSES, { message: i18nValidationMessage('validation.IS_ENUM') })
  status: TaskStatus;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Place the task before this one in the column; null/unknown = at the end',
  })
  @IsOptional()
  @IsString(isString)
  beforeId?: string | null;
}

export class ReviseTaskDto {
  @ApiPropertyOptional({ maxLength: MAX_TEXT_LENGTH })
  @IsOptional()
  @IsString(isString)
  @MaxLength(MAX_TEXT_LENGTH, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  note?: string;
}

export class CommentDto implements CommentInput {
  @ApiProperty({ maxLength: MAX_TEXT_LENGTH })
  @IsString(isString)
  @MaxLength(MAX_TEXT_LENGTH, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  markdown: string;
}

export class SchedulerStateDto implements SchedulerState {
  @ApiProperty({ description: 'When paused, agents neither progress nor pick up queued tasks' })
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  paused: boolean;
}
