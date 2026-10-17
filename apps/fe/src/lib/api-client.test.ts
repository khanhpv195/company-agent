import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data, message: 'OK' }), { status: 200 });
const unauthorized = () =>
  new Response(JSON.stringify({ success: false, data: null, message: 'Unauthorized' }), {
    status: 401,
  });

const store = new Map<string, string>();

async function load() {
  vi.resetModules();
  vi.stubEnv('VITE_MOCK', '0');
  const client = await import('./api-client');
  const tokens = await import('./auth-tokens');
  return { ...client, ...tokens };
}

describe('apiRequest refresh flow', () => {
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('refreshes once on 401 and retries the original request', async () => {
    const { api, setTokens, getTokens } = await load();
    setTokens({ accessToken: 'old', refreshToken: 'r1' });
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (url.endsWith('/auth/refresh')) return ok({ accessToken: 'new', refreshToken: 'r2' });
      return auth === 'Bearer new' ? ok({ hi: 1 }) : unauthorized();
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/things')).resolves.toEqual({ hi: 1 });
    expect(getTokens()).toEqual({ accessToken: 'new', refreshToken: 'r2' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('clears tokens and throws the 401 when refresh fails', async () => {
    const { api, ApiError, setTokens, getTokens } = await load();
    setTokens({ accessToken: 'old', refreshToken: 'r1' });
    const fetchMock = vi.fn(async () => unauthorized());
    vi.stubGlobal('fetch', fetchMock);

    const err = await api.get('/things').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(401);
    expect(getTokens()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('notifies the session-expired handler once when refresh fails, not for /auth/*', async () => {
    const { api, setTokens, setSessionExpiredHandler } = await load();
    setTokens({ accessToken: 'old', refreshToken: 'r1' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => unauthorized()),
    );
    const expired = vi.fn();
    setSessionExpiredHandler(expired);

    await expect(api.post('/things', {})).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
    await expect(api.post('/auth/login', {})).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on a 401 from /auth/*', async () => {
    const { api, setTokens, getTokens } = await load();
    setTokens({ accessToken: 'old', refreshToken: 'r1' });
    const fetchMock = vi.fn(async () => unauthorized());
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.post('/auth/login', {})).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getTokens()).toEqual({ accessToken: 'old', refreshToken: 'r1' });
  });

  it.each([
    ['status 0 (unreachable)', () => Promise.reject(new TypeError('offline')), 0],
    ['status 500', async () => new Response('{}', { status: 500 }), 500],
  ])('keeps tokens when the refresh fails with %s', async (_label, refreshImpl, status) => {
    const { api, setTokens, getTokens } = await load();
    setTokens({ accessToken: 'old', refreshToken: 'r1' });
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/auth/refresh') ? refreshImpl() : unauthorized(),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/things')).rejects.toMatchObject({ status });
    expect(getTokens()).toEqual({ accessToken: 'old', refreshToken: 'r1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries without refreshing when another refresh already rotated the token', async () => {
    const { api, setTokens } = await load();
    setTokens({ accessToken: 'old', refreshToken: 'r1' });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (auth === 'Bearer old') {
        // Another refresh finishes while this request is still in flight.
        setTokens({ accessToken: 'new', refreshToken: 'r2' });
        return unauthorized();
      }
      return ok({ hi: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/things')).resolves.toEqual({ hi: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/auth/refresh'))).toBe(false);
  });

  it('shares one refresh between parallel 401s', async () => {
    const { api, setTokens } = await load();
    setTokens({ accessToken: 'old', refreshToken: 'r1' });
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (url.endsWith('/auth/refresh')) return ok({ accessToken: 'new', refreshToken: 'r2' });
      return auth === 'Bearer new' ? ok(1) : unauthorized();
    });
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([api.get('/a'), api.get('/b')]);
    const refreshes = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/auth/refresh'));
    expect(refreshes).toHaveLength(1);
  });
});
