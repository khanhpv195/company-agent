import type { BillingSummary, BillingUrlResult, CheckoutInput, PlanResource } from '@repo/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import { useT } from '../../i18n';
import { openExternal } from '../../lib/open-external';
import { atLimit } from './billing.logic';

export const useBilling = () =>
  useQuery({
    queryKey: qk.billing,
    queryFn: () => api.get<BillingSummary>('/billing'),
    staleTime: 15_000,
    // Stripe opens in the system browser: refresh the plan when the user comes back.
    refetchOnWindowFocus: 'always',
  });

export const useCheckout = () =>
  useMutation({
    mutationFn: (input: CheckoutInput) => api.post<BillingUrlResult>('/billing/checkout', input),
    onSuccess: ({ url }) => openExternal(url),
  });

export const usePortal = () =>
  useMutation({
    mutationFn: () => api.post<BillingUrlResult>('/billing/portal'),
    onSuccess: ({ url }) => openExternal(url),
  });

/** Disabled state + tooltip for "add" buttons when the plan limit for `resource` is used up. */
export interface LimitGuard {
  blocked: boolean;
  title?: string;
}

export function useLimitGuard(resource: PlanResource): LimitGuard {
  const t = useT();
  const billing = useBilling().data;
  if (!billing || !atLimit(billing, resource)) return { blocked: false };
  return {
    blocked: true,
    title: t('billing.limitTip', {
      limit: billing.limits[resource],
      resource: t(`billing.resource.${resource}`),
      plan: t(`billing.plan.${billing.plan}`),
    }),
  };
}
