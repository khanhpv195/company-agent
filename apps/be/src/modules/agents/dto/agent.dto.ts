import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { cleanTitle } from '../../../common/utils';
import {
  MAX_TITLE,
  type Agent as AgentContract,
  type AgentActivity as AgentActivityContract,
  type AgentSkill,
  type AgentStatus,
  type CreateAgentInput,
  type UpdateAgentInput,
} from '@repo/shared';

export const MAX_PERSONA_LENGTH = 20_000;
export const MAX_NAME_LENGTH = 60;
export const MAX_WORKDIR_LENGTH = 300;
export const MAX_TURNS_LIMIT = 200;
const MAX_SKILLS = 200;

const isString = { message: i18nValidationMessage('validation.IS_STRING') };
const notEmpty = { message: i18nValidationMessage('validation.IS_NOT_EMPTY') };
const maxLength = { message: i18nValidationMessage('validation.MAX_LENGTH') };
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AgentSkillDto implements AgentSkill {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  enabled: boolean;
}

export class AgentDto implements AgentContract {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'Index of the generated avatar palette' })
  avatar: number;

  @ApiProperty({ enum: ['claude-code'] })
  provider: 'claude-code';

  @ApiProperty({ format: 'uuid' })
  computerId: string;

  @ApiProperty()
  persona: string;

  @ApiProperty({ type: [AgentSkillDto] })
  skills: AgentSkillDto[];

  @ApiProperty()
  workdir: string;

  @ApiProperty()
  maxTurns: number;

  @ApiProperty({ enum: ['idle', 'working', 'offline'], description: 'Derived on read' })
  status: AgentStatus;

  @ApiProperty({ description: 'Demo agent on a simulated computer (it cannot do real work)' })
  simulated: boolean;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  departmentId: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Nhân viên CSKH' })
  title: string | null;
}

export class AgentActivityDto implements AgentActivityContract {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '#all-members' })
  where: string;

  @ApiProperty()
  request: string;

  @ApiProperty({ enum: ['completed', 'failed', 'expired', 'cancelled'] })
  status: AgentActivityContract['status'];

  @ApiProperty({ format: 'date-time' })
  at: string;
}

export class SkillToggleDto implements Pick<AgentSkill, 'id' | 'enabled'> {
  @ApiProperty()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(200, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  id: string;

  @ApiProperty()
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  enabled: boolean;
}

export class CreateAgentDto implements CreateAgentInput {
  @ApiProperty({
    maxLength: MAX_NAME_LENGTH,
    description: 'Unique per workspace, case-insensitive',
  })
  @Transform(trim)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(MAX_NAME_LENGTH, maxLength)
  name: string;

  @ApiProperty({ format: 'uuid', description: 'A computer of the caller workspace' })
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  computerId: string;

  @ApiPropertyOptional({
    maxLength: MAX_PERSONA_LENGTH,
    description: 'Defaults to the stock persona',
  })
  @IsOptional()
  @IsString(isString)
  @MaxLength(MAX_PERSONA_LENGTH, maxLength)
  persona?: string;

  @ApiPropertyOptional({
    type: [SkillToggleDto],
    description: 'Catalog skill ids and their flags; defaults to the catalog defaults',
  })
  @IsOptional()
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ArrayMaxSize(MAX_SKILLS, maxLength)
  @ValidateNested({ each: true })
  @Type(() => SkillToggleDto)
  skills?: SkillToggleDto[];

  @ApiPropertyOptional({
    maxLength: MAX_WORKDIR_LENGTH,
    description: 'Defaults to ~/.agent/agents/<slug>',
  })
  @IsOptional()
  @Transform(trim)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(MAX_WORKDIR_LENGTH, maxLength)
  workdir?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_TURNS_LIMIT, default: 40 })
  @IsOptional()
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  @Max(MAX_TURNS_LIMIT, { message: i18nValidationMessage('validation.MAX') })
  maxTurns?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'A live department of the workspace; the agent joins its room',
  })
  @IsOptional()
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  departmentId?: string;

  @ApiPropertyOptional({ maxLength: MAX_TITLE })
  @IsOptional()
  @Transform(cleanTitle)
  @IsString(isString)
  @MaxLength(MAX_TITLE, maxLength)
  title?: string;
}

export class UpdateAgentDto implements UpdateAgentInput {
  @ApiPropertyOptional({ maxLength: MAX_PERSONA_LENGTH, description: 'Replaced when present' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(MAX_PERSONA_LENGTH, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  persona?: string;

  @ApiPropertyOptional({
    type: [SkillToggleDto],
    description: 'Toggles existing skills only; unknown ids are ignored',
  })
  @IsOptional()
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ArrayMaxSize(MAX_SKILLS, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  @ValidateNested({ each: true })
  @Type(() => SkillToggleDto)
  skills?: SkillToggleDto[];

  @ApiPropertyOptional({ maxLength: MAX_NAME_LENGTH })
  @IsOptional()
  @Transform(trim)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(MAX_NAME_LENGTH, maxLength)
  name?: string;

  @ApiPropertyOptional({ maxLength: MAX_WORKDIR_LENGTH })
  @IsOptional()
  @Transform(trim)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(MAX_WORKDIR_LENGTH, maxLength)
  workdir?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_TURNS_LIMIT })
  @IsOptional()
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  @Max(MAX_TURNS_LIMIT, { message: i18nValidationMessage('validation.MAX') })
  maxTurns?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Move to another computer of the workspace; 409 while the agent has open work',
  })
  @IsOptional()
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  computerId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'A live department of the workspace (the agent joins its room), or null for none',
  })
  @IsOptional()
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  departmentId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX_TITLE })
  @IsOptional()
  @Transform(cleanTitle)
  @IsString(isString)
  @MaxLength(MAX_TITLE, maxLength)
  title?: string | null;
}
