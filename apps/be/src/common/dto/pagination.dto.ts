import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQuery, SortOrder } from '@repo/shared';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT } from '../../contacts';

export class PaginationDto implements PaginationQuery {
  @ApiPropertyOptional({ minimum: 1, default: DEFAULT_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  @Max(MAX_LIMIT, { message: i18nValidationMessage('validation.MAX') })
  limit: number = DEFAULT_LIMIT;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder, { message: i18nValidationMessage('validation.IS_ENUM') })
  order: SortOrder = SortOrder.DESC;
}
