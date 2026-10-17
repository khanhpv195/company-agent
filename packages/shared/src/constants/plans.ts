import type { WorkspacePlan } from '../interfaces/workspace.interface';

/** A resource a plan caps. */
export type PlanResource = 'seats' | 'agents' | 'computers';

export interface PlanDefinition {
  id: WorkspacePlan;
  /** Members plus pending invites. */
  seats: number;
  /** Live (not deleted) agents. */
  agents: number;
  /** Paired, not revoked, real computers (demo machines do not count). */
  computers: number;
  /** Monthly price in USD: flat, or per seat when `perSeat` is true. */
  priceMonthlyUsd: number;
  perSeat: boolean;
}

/** The catalog, in display order. FE and BE both read it. */
export const PLANS: readonly PlanDefinition[] = [
  { id: 'free', seats: 3, agents: 2, computers: 1, priceMonthlyUsd: 0, perSeat: false },
  { id: 'pro', seats: 10, agents: 10, computers: 5, priceMonthlyUsd: 20, perSeat: false },
  { id: 'team', seats: 50, agents: 50, computers: 25, priceMonthlyUsd: 12, perSeat: true },
];

export const planById = (id: WorkspacePlan): PlanDefinition =>
  PLANS.find((plan) => plan.id === id) ?? PLANS[0];

/** Error code (`message` of the error envelope) when a plan limit blocks an action. */
export const BILLING_LIMIT_REACHED = 'billing.LIMIT_REACHED';
