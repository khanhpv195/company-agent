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
