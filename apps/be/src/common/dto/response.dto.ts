import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiResponse, CursorPageMeta, PaginationMeta } from '@repo/shared';

export class PaginationMetaDto implements PaginationMeta {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 5 })
  totalPages: number;
}

export class ResponseDto<T = unknown> implements ApiResponse<T> {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty()
  data: T;

  @ApiProperty({ example: 'Request succeeded' })
  message: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  meta?: Record<string, unknown>;
}

/** Return this from a handler to get `data: items` and `meta` in the response envelope. */
export class PaginatedResult<T> {
  constructor(
    readonly items: T[],
    readonly meta: PaginationMeta,
  ) {}

  static of<T>(items: T[], total: number, page: number, limit: number): PaginatedResult<T> {
    return new PaginatedResult(items, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }
}

/**
 * Keyset-paged list: `data = items`, `meta = { limit, nextCursor }` and no total, so no
 * `count(*)` per page. `nextCursor` is null when the list has ended.
 */
export class CursorResult<T> {
  constructor(
    readonly items: T[],
    readonly meta: CursorPageMeta,
  ) {}
}
