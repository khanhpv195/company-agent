import { beforeEach, describe, expect, it } from 'vitest';
import { useUi } from '../stores/ui';
import { ApiError } from './api-client';
import { createQueryClient, mutationErrorText } from './query-client';

describe('global mutation error toast', () => {
  beforeEach(() => useUi.setState({ toast: null }));

  const run = async (error: unknown, meta?: { silentError?: boolean }) => {
    const client = createQueryClient();
    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(error), meta })
      .execute(undefined)
      .catch(() => undefined);
  };

  it('toasts the ApiError message', async () => {
    await run(new ApiError('Máy không tồn tại', 404));
    expect(useUi.getState().toast).toMatchObject({ text: 'Máy không tồn tại', tone: 'error' });
  });

  it('falls back to a generic message for unknown errors', async () => {
    await run(new Error('boom'));
    expect(useUi.getState().toast?.text).toBe(mutationErrorText(new Error('boom')));
  });

  it('stays quiet for silentError and for 401', async () => {
    await run(new ApiError('x', 400), { silentError: true });
    expect(useUi.getState().toast).toBeNull();
    await run(new ApiError('expired', 401));
    expect(useUi.getState().toast).toBeNull();
  });

  it('adds an Upgrade action to a plan limit error', async () => {
    await run(
      new ApiError('Limit', 403, {
        success: false,
        data: null,
        message: 'billing.LIMIT_REACHED',
        meta: {
          statusCode: 403,
          path: '/agents',
          timestamp: '',
          details: { resource: 'agents', limit: 2, used: 2, plan: 'free' },
        },
      }),
    );
    expect(useUi.getState().toast?.action).toMatchObject({ to: '/settings/billing' });
    await run(new ApiError('Other', 403));
    expect(useUi.getState().toast?.action).toBeUndefined();
  });
});
