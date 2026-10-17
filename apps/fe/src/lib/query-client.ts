import { MutationCache, QueryClient } from '@tanstack/react-query';
import { translate } from '../i18n';
import { useUi } from '../stores/ui';
import { limitDetailsOf } from '../features/billing/billing.logic';
import { ApiError } from './api-client';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** The caller renders this mutation's error itself (inline), so no global toast. */
      silentError?: boolean;
    };
  }
}

/** Text shown for a failed mutation: the API's (localized) message, else a generic one. */
export const mutationErrorText = (error: unknown): string =>
  error instanceof ApiError && error.message ? error.message : translate('errors.unknown');

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false },
    },
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.meta?.silentError) return;
        // A final 401 already sends the user to the login screen.
        if (error instanceof ApiError && error.status === 401) return;
        // A plan limit offers the way out: the billing screen.
        const limit = limitDetailsOf(error);
        useUi.getState().showToast({
          text: mutationErrorText(error),
          agentId: null,
          taskId: null,
          tone: 'error',
          ...(limit
            ? { action: { label: translate('billing.upgrade'), to: '/settings/billing' } }
            : {}),
        });
      },
    }),
  });
}
