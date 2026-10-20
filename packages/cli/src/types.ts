/**
 * Wire contract of the gateway (`/api/v1/gateway/*`). Kept local on purpose:
 * the daemon is distributed separately from `@repo/shared`.
 */

export type MemberRole = 'owner' | 'admin' | 'member';

export interface SkillDef {
  slug: string;
  name: string;
  description: string;
  content: string;
  version: number;
}

export interface GatewayAgent {
  id: string;
  name: string;
  persona: string;
  workdir: string;
  maxTurns: number;
  skills: string[];
  /** Enabled workspace skills with content: only on a claimed assignment (heartbeats omit it). */
  skillDefs?: SkillDef[];
}

export interface GatewayAssignment {
  id: string;
  attempt: number;
  kind: 'chat' | 'task';
  agent: GatewayAgent;
  session: { id: string; resume: boolean };
  prompt: string;
  context: string;
  requestedBy: { id: string; name: string; role: MemberRole } | null;
  leaseMs: number;
}

export interface GatewayToolCall {
  id: string;
  name: string;
  input: string;
  output: string | null;
  status: 'running' | 'ok' | 'error';
}

export type GatewayEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'tool'; call: GatewayToolCall }
  | { kind: 'turns'; turns: number };

export interface GatewayResult {
  attempt: number;
  status: 'completed' | 'failed';
  text?: string;
  error?: string;
  sessionId?: string;
  numTurns?: number;
  costUsd?: number;
}

export interface PairResponse {
  computerId: string;
  apiKey: string;
  workspace: { id: string; name: string; slug: string };
}
