import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import type {
  Agent as AgentContract,
  AgentActivity as AgentActivityContract,
  AgentSkill,
  AgentStatus,
  UpdateAgentInput,
} from '@repo/shared';

export const MAX_PERSONA_LENGTH = 20_000;
const MAX_SKILLS = 200;

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
}
