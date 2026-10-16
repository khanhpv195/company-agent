import type { ApiErrorResponse, ApiResponse } from '@repo/shared';

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1').replace(
  /\/+$/,
  '',
);

/** VITE_MOCK=1 answers every request from the in-app mock backend (src/mocks). */
export const MOCK = import.meta.env.VITE_MOCK === '1';

const transport = (url: string, init: RequestInit): Promise<Response> =>
  MOCK ? import('../mocks/server').then((m) => m.mockFetch(url, init)) : fetch(url, init);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: ApiErrorResponse,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type QueryValue = string | number | boolean | undefined | null;

export const toSearchParams = (params: Record<string, QueryValue>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
};

export async function apiRequest<TData, TMeta = Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResponse<TData, TMeta>> {
  let response: Response;
  try {
    response = await transport(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': navigator.language,
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(`Cannot reach the API at ${API_URL}`, 0);
  }

  const body = (await response.json().catch(() => null)) as
    ApiResponse<TData, TMeta> | ApiErrorResponse | null;

  if (!response.ok || !body?.success) {
    const error = body as ApiErrorResponse | null;
    throw new ApiError(error?.message || response.statusText, response.status, error ?? undefined);
  }

  return body as ApiResponse<TData, TMeta>;
}

const send =
  (method: string) =>
  <TData>(path: string, body?: unknown) =>
    apiRequest<TData>(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => r.data);

/** Shorthands that return only `data`. */
export const api = {
  get: <TData>(path: string) => apiRequest<TData>(path).then((r) => r.data),
  post: send('POST'),
  patch: send('PATCH'),
  put: send('PUT'),
  delete: send('DELETE'),
};
