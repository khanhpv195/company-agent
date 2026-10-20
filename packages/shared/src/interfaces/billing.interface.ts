import type { PlanDefinition, PlanResource } from '../constants/plans';
import type { WorkspacePlan } from './workspace.interface';

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';

export interface BillingSubscription {
  status: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingByAgent {
  agentId: string;
  name: string;
  costUsd: number;
  runs: number;
}

export interface BillingByDay {
  /** `YYYY-MM-DD` in the workspace timezone. */
  date: string;
  costUsd: number;
  runs: number;
}

export interface BillingSummary {
  plan: WorkspacePlan;
  limits: Pick<PlanDefinition, 'seats' | 'agents' | 'computers'>;
  /** Seats = members plus pending invites; computers exclude revoked and demo machines. */
  usage: Record<PlanResource, number>;
  /** The calendar month in the workspace timezone: `start` inclusive, `end` exclusive (ISO). */
  period: { start: string; end: string };
  costUsd: number;
  runs: number;
  byAgent: BillingByAgent[];
  byDay: BillingByDay[];
  /** `null` when the workspace never subscribed. Stripe ids are never exposed. */
  subscription: BillingSubscription | null;
  /** False when `BILLING_PROVIDER=none` (checkout and portal answer 409). */
  checkoutAvailable: boolean;
  /** False when the server does not enforce plan limits (`BILLING_LIMITS_ENABLED=false`): clients hide the plan UI. */
  limitsEnabled: boolean;
}

export interface CheckoutInput {
  plan: Exclude<WorkspacePlan, 'free'>;
}

export interface BillingUrlResult {
  url: string;
}

/** Machine-readable part of a `billing.LIMIT_REACHED` error (`meta.details`). */
export interface LimitReachedDetails {
  resource: PlanResource;
  limit: number;
  used: number;
  plan: WorkspacePlan;
}
