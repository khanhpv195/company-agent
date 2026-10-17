import type {
  BillingSummary,
  LimitReachedDetails,
  PlanDefinition,
  PlanResource,
  WorkspacePlan,
} from '@repo/shared';
import { PLANS } from '@repo/shared';
import { ApiError } from '../../lib/api-client';

export const RESOURCES: readonly PlanResource[] = ['seats', 'agents', 'computers'];

export type MeterLevel = 'ok' | 'warn' | 'full';

export interface Meter {
  used: number;
  limit: number;
  /** 0 to 100, for the bar width. */
  pct: number;
  level: MeterLevel;
}

/** Warning color from 80% of the limit, "full" at or over it. */
export function meterOf(used: number, limit: number): Meter {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const ratio = limit > 0 ? used / limit : 1;
  const level: MeterLevel = ratio >= 1 ? 'full' : ratio >= 0.8 ? 'warn' : 'ok';
  return { used, limit, pct, level };
}

export const atLimit = (
  billing: Pick<BillingSummary, 'usage' | 'limits'> | undefined,
  resource: PlanResource,
): boolean => !!billing && billing.usage[resource] >= billing.limits[resource];

const isResource = (v: unknown): v is PlanResource => RESOURCES.includes(v as PlanResource);

/** The machine-readable part of a 403 `billing.LIMIT_REACHED` error, or null for anything else. */
export function limitDetailsOf(error: unknown): LimitReachedDetails | null {
  if (!(error instanceof ApiError)) return null;
  const d = error.body?.meta?.details;
  if (!d || !isResource(d.resource)) return null;
  return {
    resource: d.resource,
    limit: Number(d.limit) || 0,
    used: Number(d.used) || 0,
    plan: (d.plan as WorkspacePlan) ?? 'free',
  };
}

export type PlanCardState = 'current' | 'upgrade' | 'downgrade' | 'contact';

const rank = (id: WorkspacePlan) => PLANS.findIndex((p) => p.id === id);

/** What a plan card offers: contact sales when checkout is off, else upgrade/downgrade. */
export function planCardState(
  plan: Pick<PlanDefinition, 'id'>,
  current: WorkspacePlan,
  checkoutAvailable: boolean,
): PlanCardState {
  if (plan.id === current) return 'current';
  if (!checkoutAvailable) return 'contact';
  return rank(plan.id) > rank(current) ? 'upgrade' : 'downgrade';
}

/** A subscribed workspace changes plan in the Stripe portal; checkout answers 409 for it. */
export function planActionKind(
  plan: Pick<PlanDefinition, 'id'>,
  subscription: Pick<NonNullable<BillingSummary['subscription']>, 'status'> | null,
): 'checkout' | 'portal' {
  const subscribed = !!subscription?.status && subscription.status !== 'canceled';
  return plan.id === 'free' || subscribed ? 'portal' : 'checkout';
}

/** `mailto:` link for "contact sales", or null when no address is configured. */
export function salesMailto(email: string | undefined, plan: WorkspacePlan): string | null {
  const to = email?.trim();
  if (!to) return null;
  return `mailto:${to}?subject=${encodeURIComponent(`Agent: ${plan} plan`)}`;
}

/** Bar height (0 to 100) of a day in the per-day cost chart. */
export function barPct(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(4, Math.round((value / max) * 100));
}
