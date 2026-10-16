import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateTodoInput, TodoPriority } from '@repo/shared';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTodoDto implements CreateTodoInput {
  @ApiProperty({ maxLength: 255, example: 'Write the README' })
  @Transform(trim)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(255, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  title: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(2000, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  description?: string;

  @ApiPropertyOptional({ enum: TodoPriority, default: TodoPriority.MEDIUM })
  @IsOptional()
  @IsEnum(TodoPriority, { message: i18nValidationMessage('validation.IS_ENUM') })
  priority?: TodoPriority;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  completed?: boolean;
}
