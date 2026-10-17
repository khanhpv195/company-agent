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
  /** Machine-readable context of some errors (e.g. `billing.LIMIT_REACHED`). */
  details?: Record<string, unknown>;
  /** Correlation id, also sent as the `x-request-id` response header: quote it in bug reports. */
  requestId?: string;
}

export type ApiErrorResponse = ApiResponse<null, ApiErrorMeta>;

export interface HealthStatus {
  status: 'ok';
  uptime: number;
}

/** `GET /health/ready`: the API can serve traffic only while the database answers. */
export interface ReadinessStatus {
  status: 'ok' | 'unavailable';
  db: 'up' | 'down';
}
