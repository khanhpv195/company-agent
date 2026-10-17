import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../../contacts';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 'unit-test-secret-0123456789abcdefghij';
const MID = '3f0f8c0e-6d7a-4c52-9a53-2d4d3a1f0001';
const WID = '3f0f8c0e-6d7a-4c52-9a53-2d4d3a1f0002';
const config = {
  accessSecret: SECRET,
  accessTtl: '15m',
  refreshTtl: '30d',
  throttleLimit: 10,
  throttleTtl: '60s',
  argon2: { memoryCost: 4096, timeCost: 2, parallelism: 1 },
};

describe('JwtAuthGuard', () => {
  const jwt = new JwtService();
  const reflector = new Reflector();
  let row:
    | { workspace_id: string; role: string; removed_at: Date | null; session_live: boolean }
    | undefined;
  const dataSource = { query: jest.fn(() => Promise.resolve(row ? [row] : [])) };
  const guard = new JwtAuthGuard(reflector, jwt, config, dataSource as never);
  beforeEach(() => {
    row = { workspace_id: WID, role: 'owner', removed_at: null, session_live: true };
    dataSource.query.mockClear();
  });

  const handler = () => undefined;
  class Ctrl {}

  const makeContext = (headers: Record<string, string>, isPublic = false) => {
    const request: { headers: Record<string, string>; auth?: unknown } = { headers };
    if (isPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    else Reflect.deleteMetadata(IS_PUBLIC_KEY, handler);
    const context = {
      getType: () => 'http',
      getHandler: () => handler,
      getClass: () => Ctrl,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  const sign = (payload: object, secret = SECRET, expiresIn: number | string = 60) =>
    jwt.signAsync(payload, { secret, expiresIn: expiresIn as number, algorithm: 'HS256' });

  const SID = '3f0f8c0e-6d7a-4c52-9a53-2d4d3a1f0003';
  const payload = { sub: MID, wid: WID, role: 'owner', sid: SID };

  it('lets @Public() routes through without a token', async () => {
    const { context } = makeContext({}, true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it.each([
    ['missing header', {}],
    ['wrong scheme', { authorization: 'Basic abc' }],
    ['garbage token', { authorization: 'Bearer not-a-jwt' }],
  ])('rejects %s with 401', async (_name, headers) => {
    const { context } = makeContext(headers);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    const token = await sign(payload, SECRET, -10);
    const { context } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await sign(payload, 'another-secret-0123456789abcdefghijkl');
    const { context } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token with an unknown role', async () => {
    const token = await sign({ ...payload, role: 'root' });
    const { context } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose member is missing or removed', async () => {
    const token = await sign(payload);
    row = undefined;
    await expect(
      guard.canActivate(makeContext({ authorization: `Bearer ${token}` }).context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    row = { workspace_id: WID, role: 'owner', removed_at: new Date(), session_live: true };
    await expect(
      guard.canActivate(makeContext({ authorization: `Bearer ${token}` }).context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose session is gone, or that has no (valid) sid', async () => {
    row = { workspace_id: WID, role: 'owner', removed_at: null, session_live: false };
    await expect(
      guard.canActivate(makeContext({ authorization: `Bearer ${await sign(payload)}` }).context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    row = { workspace_id: WID, role: 'owner', removed_at: null, session_live: true };
    for (const claims of [
      { sub: MID, wid: WID, role: 'owner' },
      { ...payload, sid: 'family-1' },
    ]) {
      await expect(
        guard.canActivate(makeContext({ authorization: `Bearer ${await sign(claims)}` }).context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('rejects a token for another workspace than the member belongs to', async () => {
    const token = await sign({ ...payload, wid: '3f0f8c0e-6d7a-4c52-9a53-2d4d3a1f0099' });
    await expect(
      guard.canActivate(makeContext({ authorization: `Bearer ${token}` }).context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a valid token and sets req.auth with the database role', async () => {
    row = { workspace_id: WID, role: 'admin', removed_at: null, session_live: true };
    const token = await sign(payload);
    const { context, request } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.auth).toEqual({
      memberId: MID,
      workspaceId: WID,
      role: 'admin',
      sessionId: SID,
      // the token's expiry, which the SSE stream uses to end itself
      exp: expect.any(Number),
    });
  });
});
