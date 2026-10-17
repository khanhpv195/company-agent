/**
 * Whoever executes offered task assignments on a computer: claims them, reports progress,
 * renews leases and posts the result through the agent gateway. The simulator implements it
 * today; the real daemon (HTTP `/gateway/*`) replaces it later without touching the engine.
 */
export interface AgentRunner {
  /** One scheduling pass over everything this runner is responsible for. */
  runPass(): Promise<void>;
}
