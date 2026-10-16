import { ApiPropertyOptional } from '@nestjs/swagger';
import { TodoPriority, TodoQuery } from '@repo/shared';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaginationDto } from '../../../common/dto';

const toBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

export class QueryTodoDto extends PaginationDto implements TodoQuery {
  @ApiPropertyOptional({ description: 'Case-insensitive search on title' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(100, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  search?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  completed?: boolean;

  @ApiPropertyOptional({ enum: TodoPriority })
  @IsOptional()
  @IsEnum(TodoPriority, { message: i18nValidationMessage('validation.IS_ENUM') })
  priority?: TodoPriority;
}
