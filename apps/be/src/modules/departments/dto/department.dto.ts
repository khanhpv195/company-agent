import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEPARTMENT_ICONS,
  MAX_DEPARTMENT_NAME,
  MAX_TITLE,
  type CreateDepartmentInput,
  type Department as DepartmentContract,
  type DepartmentIcon,
  type ReorderDepartmentsInput,
  type SetDepartmentInput,
  type SetMemberTitleInput,
  type UpdateDepartmentInput,
} from '@repo/shared';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { cleanDepartmentName, cleanTitle } from '../../../common/utils';

const MAX_DEPARTMENTS = 200;

const isString = { message: i18nValidationMessage('validation.IS_STRING') };
const notEmpty = { message: i18nValidationMessage('validation.IS_NOT_EMPTY') };
const maxLength = { message: i18nValidationMessage('validation.MAX_LENGTH') };
const isIcon = { message: i18nValidationMessage('validation.IS_ENUM') };

export class DepartmentDto implements DepartmentContract {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Kinh doanh' })
  name: string;

  @ApiProperty({ enum: DEPARTMENT_ICONS })
  icon: DepartmentIcon;

  @ApiProperty({ description: 'Display order, 0-based' })
  rank: number;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  roomId: string | null;
}

export class CreateDepartmentDto implements CreateDepartmentInput {
  @ApiProperty({
    maxLength: MAX_DEPARTMENT_NAME,
    description: 'Unique per workspace, case-insensitive',
  })
  @Transform(cleanDepartmentName)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(MAX_DEPARTMENT_NAME, maxLength)
  name: string;

  @ApiPropertyOptional({ enum: DEPARTMENT_ICONS, default: 'users' })
  @IsOptional()
  @IsIn(DEPARTMENT_ICONS, isIcon)
  icon?: DepartmentIcon;
}

export class UpdateDepartmentDto implements UpdateDepartmentInput {
  @ApiPropertyOptional({
    maxLength: MAX_DEPARTMENT_NAME,
    description: 'The department room keeps its name',
  })
  @IsOptional()
  @Transform(cleanDepartmentName)
  @IsString(isString)
  @IsNotEmpty(notEmpty)
  @MaxLength(MAX_DEPARTMENT_NAME, maxLength)
  name?: string;

  @ApiPropertyOptional({ enum: DEPARTMENT_ICONS })
  @IsOptional()
  @IsIn(DEPARTMENT_ICONS, isIcon)
  icon?: DepartmentIcon;
}

export class ReorderDepartmentsDto implements ReorderDepartmentsInput {
  @ApiProperty({
    type: [String],
    description: 'Exactly the live department ids, in the new order',
  })
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ArrayMaxSize(MAX_DEPARTMENTS, maxLength)
  @IsUUID(undefined, { each: true, message: i18nValidationMessage('validation.IS_UUID') })
  ids: string[];
}

export class SetDepartmentDto implements SetDepartmentInput {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'A live department of the workspace, or null for none',
  })
  @ValidateIf((dto: SetDepartmentDto) => dto.departmentId !== null)
  @IsString(isString)
  departmentId: string | null;
}

export class SetMemberTitleDto implements SetMemberTitleInput {
  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: MAX_TITLE,
    description: 'Empty or null clears the title',
  })
  @Transform(cleanTitle)
  @ValidateIf((dto: SetMemberTitleDto) => dto.title !== null)
  @IsString(isString)
  @MaxLength(MAX_TITLE, maxLength)
  title: string | null;
}
