import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MAX_SKILL_CONTENT,
  MAX_SKILL_DESCRIPTION,
  MAX_SKILL_NAME,
  MAX_SKILL_SLUG,
  type CreateSkillInput,
  type RestoreSkillInput,
  type SetAgentSkillsInput,
  type Skill as SkillContract,
  type SkillVersion as SkillVersionContract,
  type UpdateSkillInput,
} from '@repo/shared';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  type ValidationOptions,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { cleanDepartmentName } from '../../../common/utils';

/** Far above `MAX_AGENT_SKILLS`: the service answers an over-long list with its own 400. */
const MAX_SKILL_IDS = 200;
export const SKILL_SLUG_PATTERN = /^[a-z0-9-]{1,64}$/;

const isString = { message: i18nValidationMessage('validation.IS_STRING') };
const notEmpty = { message: i18nValidationMessage('validation.IS_NOT_EMPTY') };
const maxLength = { message: i18nValidationMessage('validation.MAX_LENGTH') };

/** Postgres text cannot hold NUL; other characters (newlines, tabs) are content. */
const cleanContent = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.split('\u0000').join('') : value;

/**
 * At most `max` UTF-16 code units (`string.length`), the unit the services and the shared limits
 * count in. class-validator's `@MaxLength` counts code points, which lets emoji past the limit.
 */
export function MaxUtf16Length(max: number, options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'maxUtf16Length',
      constraints: [max],
      validator: {
        validate: (value: unknown) => typeof value === 'string' && value.length <= max,
      },
    },
    options,
  );
}

export class SkillDto implements SkillContract {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'bao-gia', description: '[a-z0-9-], unique among the live skills' })
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'Tells Claude when to use the skill' })
  description: string;

  @ApiProperty({ description: 'SKILL.md body (markdown)' })
  content: string;

  @ApiProperty({ type: String, nullable: true })
  templateId: string | null;

  @ApiProperty({ description: 'Starts at 1, +1 on every name, description or content change' })
  version: number;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  createdById: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  updatedById: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  @ApiProperty({ type: [String], description: 'Live agents that have it enabled' })
  agentIds: string[];
}

export class SkillVersionDto implements SkillVersionContract {
  @ApiProperty()
  version: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  content: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  editedById: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class CreateSkillDto implements Partial<CreateSkillInput> {
  @ApiPropertyOptional({
    maxLength: MAX_SKILL_SLUG,
    description:
      'Lowercase letters, digits and `-`. Defaults to the slug of the name (409 when taken ' +
      'and given; a derived slug gets `-2`, `-3`... instead)',
  })
  @IsOptional()
  @IsString(isString)
  @Matches(SKILL_SLUG_PATTERN, { message: i18nValidationMessage('validation.IS_SLUG') })
  slug?: string;

  @ApiPropertyOptional({
    maxLength: MAX_SKILL_NAME,
    description: 'Required unless `templateId` is given',
  })
  @ValidateIf((dto: CreateSkillDto) => !dto.templateId || dto.name !== undefined)
  @Transform(cleanDepartmentName)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(MAX_SKILL_NAME, maxLength)
  name?: string;

  @ApiPropertyOptional({
    maxLength: MAX_SKILL_DESCRIPTION,
    description: 'Tells Claude when to use the skill. Required unless `templateId` is given',
  })
  @ValidateIf((dto: CreateSkillDto) => !dto.templateId || dto.description !== undefined)
  @Transform(cleanDepartmentName)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(MAX_SKILL_DESCRIPTION, maxLength)
  description?: string;

  @ApiPropertyOptional({
    maxLength: MAX_SKILL_CONTENT,
    description: 'SKILL.md body. Required unless `templateId` is given',
  })
  @ValidateIf((dto: CreateSkillDto) => !dto.templateId || dto.content !== undefined)
  @Transform(cleanContent)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxUtf16Length(MAX_SKILL_CONTENT, maxLength)
  content?: string;

  @ApiPropertyOptional({ description: 'A skill template id; the fields left out come from it' })
  @IsOptional()
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(100, maxLength)
  templateId?: string;
}

export class UpdateSkillDto implements UpdateSkillInput {
  @ApiPropertyOptional({ maxLength: MAX_SKILL_NAME })
  @IsOptional()
  @Transform(cleanDepartmentName)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(MAX_SKILL_NAME, maxLength)
  name?: string;

  @ApiPropertyOptional({ maxLength: MAX_SKILL_DESCRIPTION })
  @IsOptional()
  @Transform(cleanDepartmentName)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(MAX_SKILL_DESCRIPTION, maxLength)
  description?: string;

  @ApiPropertyOptional({ maxLength: MAX_SKILL_CONTENT })
  @IsOptional()
  @Transform(cleanContent)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxUtf16Length(MAX_SKILL_CONTENT, maxLength)
  content?: string;
}

export class RestoreSkillDto implements RestoreSkillInput {
  @ApiProperty({ minimum: 1, description: 'The version to copy into a new one' })
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  version: number;
}

export class SetAgentSkillsDto implements SetAgentSkillsInput {
  @ApiProperty({
    type: [String],
    description: 'The full set of skills enabled on the agent (live skills of the workspace)',
  })
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ArrayMaxSize(MAX_SKILL_IDS, maxLength)
  @IsString({ each: true, ...isString })
  skillIds: string[];
}
