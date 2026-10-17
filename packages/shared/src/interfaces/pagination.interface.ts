import type { SortOrder } from '../enums';
import type { ApiResponse } from './api-response.interface';

export interface PaginationQuery {
  page?: number;
  limit?: number;
  order?: SortOrder;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type PaginatedResponse<T> = ApiResponse<T[], PaginationMeta>;

/**
 * Meta of a keyset-paged list (newest first). `nextCursor` is opaque: pass it back as `before`
 * to get the following page; `null` means the list has ended. There is no total.
 */
export interface CursorPageMeta {
  limit: number;
  nextCursor: string | null;
}

export type CursorPageResponse<T> = ApiResponse<T[], CursorPageMeta>;
