import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../../contacts';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 'unit-test-secret-0123456789abcdefghij';
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
  const guard = new JwtAuthGuard(reflector, jwt, config);

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

  const payload = { sub: 'm1', wid: 'w1', role: 'owner' };

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

  it('accepts a valid token and sets req.auth', async () => {
    const token = await sign(payload);
    const { context, request } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.auth).toEqual({
      memberId: 'm1',
      workspaceId: 'w1',
      role: 'owner',
      // the token's expiry, which the SSE stream uses to end itself
      exp: expect.any(Number),
    });
  });
});
