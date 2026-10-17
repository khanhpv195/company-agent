import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

const isString = { message: i18nValidationMessage('validation.IS_STRING') };
const notEmpty = { message: i18nValidationMessage('validation.IS_NOT_EMPTY') };
const isInt = { message: i18nValidationMessage('validation.IS_INT') };
const maxLength = { message: i18nValidationMessage('validation.MAX_LENGTH') };
const min = { message: i18nValidationMessage('validation.MIN') };
const max = { message: i18nValidationMessage('validation.MAX') };
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const MAX_PROGRESS_EVENTS = 1000;
/** Stored result text is cut to this length (with a note) rather than rejected. */
export const MAX_RESULT_TEXT = 100_000;
/** Largest result text accepted at all; the 2 MB body limit applies as well. */
export const MAX_RESULT_INPUT = 2_000_000;

// ---------- pairing ----------
export class PairingCodeDto {
  @ApiProperty({ example: 'ABCD-EFGH', description: 'Single use, valid for 10 minutes' })
  code: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;
}

export class PairDto {
  @ApiProperty({ example: 'ABCD-EFGH' })
  @Transform(trim)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(32, maxLength)
  code: string;

  @ApiProperty({ example: 'khanhpv-MacBook-Pro' })
  @Transform(trim)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(100, maxLength)
  name: string;

  @ApiProperty({ example: 'macOS 26.1 · arm64' })
  @Transform(trim)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(200, maxLength)
  os: string;

  @ApiProperty({ example: '0.1.0' })
  @Transform(trim)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(50, maxLength)
  cliVersion: string;
}

class PairWorkspaceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;
}

export class PairResultDto {
  @ApiProperty({ format: 'uuid' })
  computerId: string;

  @ApiProperty({ example: 'agk_...', description: 'Shown only once' })
  apiKey: string;

  @ApiProperty({ type: PairWorkspaceDto })
  workspace: PairWorkspaceDto;
}

// ---------- daemon calls ----------
export class HeartbeatDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString(isString)
  @MaxLength(50, maxLength)
  cliVersion?: string;

  @ApiPropertyOptional({
    description:
      "Assignment ids the daemon is running now; `cancelled` then lists the ones to stop. Without it, `cancelled` lists this computer's recently cancelled or expired assignments.",
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ArrayMaxSize(100, maxLength)
  @IsString({ each: true, ...isString })
  running?: string[];
}

export class ClaimDto {
  @ApiPropertyOptional({
    description: 'Free chat slots of the daemon; 0 claims task runs only',
    minimum: 0,
  })
  @IsOptional()
  @IsInt(isInt)
  @Min(0, min)
  @Max(100, max)
  maxChats?: number;
}

export class AttemptDto {
  @ApiProperty({ minimum: 0 })
  @IsInt(isInt)
  @Min(0, min)
  attempt: number;
}

export class ProgressDto extends AttemptDto {
  @ApiProperty({
    description:
      'Events: { kind: "text", delta } | { kind: "tool", call } | { kind: "turns", turns }',
    type: [Object],
  })
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ArrayMaxSize(MAX_PROGRESS_EVENTS, maxLength)
  @IsObject({ each: true })
  events: Record<string, unknown>[];
}

export class ResultDto extends AttemptDto {
  @ApiProperty({ enum: ['completed', 'failed'] })
  @IsIn(['completed', 'failed'], { message: i18nValidationMessage('validation.IS_ENUM') })
  status: 'completed' | 'failed';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString(isString)
  @MaxLength(MAX_RESULT_INPUT, maxLength)
  text?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString(isString)
  @MaxLength(10_000, maxLength)
  error?: string;

  @ApiPropertyOptional({ description: 'Claude Code session id, resumed by the next run' })
  @IsOptional()
  @IsString(isString)
  @MaxLength(100, maxLength)
  sessionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt(isInt)
  @Min(0, min)
  numTurns?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({}, { message: i18nValidationMessage('validation.IS_INT') })
  @Min(0, min)
  costUsd?: number;
}
