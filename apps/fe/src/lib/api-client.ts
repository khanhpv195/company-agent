import type { ApiErrorResponse, ApiResponse, AuthResult } from '@repo/shared';
import { getLocale, translate } from '../i18n';
import { clearTokens, getTokens, setTokens } from './auth-tokens';
import { reportApiReachable } from './connectivity';

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

async function execute<TData, TMeta>(
  path: string,
  init: RequestInit,
): Promise<ApiResponse<TData, TMeta>> {
  const tokens = getTokens();
  let response: Response;
  try {
    response = await transport(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': getLocale(),
        ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
        ...init.headers,
      },
    });
  } catch (e) {
    // A caller-initiated abort says nothing about the API.
    if ((e as { name?: string } | null)?.name === 'AbortError') throw e;
    reportApiReachable(false);
    throw new ApiError(translate('errors.unreachable'), 0);
  }
  reportApiReachable(true);

  const body = (await response.json().catch(() => null)) as
    ApiResponse<TData, TMeta> | ApiErrorResponse | null;

  if (!response.ok || !body?.success) {
    const error = body as ApiErrorResponse | null;
    throw new ApiError(error?.message || response.statusText, response.status, error ?? undefined);
  }

  return body as ApiResponse<TData, TMeta>;
}

let refreshing: Promise<boolean> | null = null;

/** Single-flight: parallel 401s share one /auth/refresh call. */
export function refreshTokens(): Promise<boolean> {
  refreshing ??= (async () => {
    const tokens = getTokens();
    if (!tokens) return false;
    try {
      const res = await execute<AuthResult, Record<string, unknown>>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      setTokens({ accessToken: res.data.accessToken, refreshToken: res.data.refreshToken });
      return true;
    } catch (e) {
      // Only a rejected refresh token ends the session; outages keep it for a later retry.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        clearTokens();
        return false;
      }
      throw e;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

let onSessionExpired: (() => void) | null = null;

/** Registers the one place that reacts to a final 401 (queries and mutations alike). */
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

/** For non-fetch callers (the SSE client) that find the session gone: routes the app to login. */
export function triggerSessionExpired(): void {
  onSessionExpired?.();
}

const isUnauthorized = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 401;

export async function apiRequest<TData, TMeta = Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResponse<TData, TMeta>> {
  const sentWith = getTokens()?.accessToken;
  try {
    return await execute<TData, TMeta>(path, init);
  } catch (e) {
    if (!isUnauthorized(e) || path.startsWith('/auth/')) throw e;
    // Another request already rotated the tokens while this one was in flight: just retry.
    const current = getTokens()?.accessToken;
    if (!current || current === sentWith) {
      if (!(await refreshTokens())) {
        onSessionExpired?.();
        throw e;
      }
    }
    try {
      return await execute<TData, TMeta>(path, init);
    } catch (retryError) {
      // Still 401 with freshly rotated tokens: the session is gone.
      if (isUnauthorized(retryError)) onSessionExpired?.();
      throw retryError;
    }
  }
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
