import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AuditEvent } from '@repo/shared';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min, ValidateBy } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { decodeAuditCursor } from '../audit-cursor';

const DEFAULT_AUDIT_LIMIT = 50;
const MAX_AUDIT_LIMIT = 100;

export class AuditQueryDto {
  @ApiPropertyOptional({
    description: 'Opaque cursor: the `meta.nextCursor` of the previous page',
  })
  @IsOptional()
  @ValidateBy(
    {
      name: 'isAuditCursor',
      validator: { validate: (value: unknown) => decodeAuditCursor(value) !== null },
    },
    { message: i18nValidationMessage('validation.IS_CURSOR') },
  )
  before?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_AUDIT_LIMIT, default: DEFAULT_AUDIT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  @Max(MAX_AUDIT_LIMIT, { message: i18nValidationMessage('validation.MAX') })
  limit: number = DEFAULT_AUDIT_LIMIT;
}

class AuditActorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}

export class AuditEventDto implements AuditEvent {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'date-time' })
  at: string;

  @ApiProperty({ type: AuditActorDto, nullable: true })
  actor: AuditActorDto | null;

  @ApiProperty({ example: 'agent.created' })
  action: string;

  @ApiProperty({ type: String, nullable: true })
  targetType: string | null;

  @ApiProperty({ type: String, nullable: true })
  targetId: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  meta: Record<string, unknown>;

  @ApiProperty({ type: String, nullable: true })
  ip: string | null;
}
