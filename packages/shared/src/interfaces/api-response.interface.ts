export interface ApiResponse<TData = unknown, TMeta = Record<string, unknown>> {
  success: boolean;
  data: TData;
  message: string;
  meta?: TMeta;
}

export interface ApiFieldError {
  field: string;
  messages: string[];
}

export interface ApiErrorMeta {
  statusCode: number;
  path: string;
  timestamp: string;
  errors?: ApiFieldError[];
}

export type ApiErrorResponse = ApiResponse<null, ApiErrorMeta>;

export interface HealthStatus {
  status: 'ok';
  uptime: number;
}
