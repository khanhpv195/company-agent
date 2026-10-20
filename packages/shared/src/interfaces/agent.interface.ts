export type AgentStatus = 'idle' | 'working' | 'offline';

export interface AgentSkill {
  id: string;
  name: string;
  enabled: boolean;
}

export interface Agent {
  id: string;
  name: string;
  /** Index of the generated avatar palette. */
  avatar: number;
  provider: 'claude-code';
  computerId: string;
  persona: string;
  skills: AgentSkill[];
  workdir: string;
  maxTurns: number;
  status: AgentStatus;
  /** Demo agent on a simulated computer: it only plays scripted, honest demo replies. */
  simulated: boolean;
  departmentId: string | null;
  title: string | null;
}

export interface CreateAgentInput {
  /** 1..60 characters, unique per workspace (case-insensitive). */
  name: string;
  /** A computer of the same workspace. */
  computerId: string;
  /** Defaults to the stock persona. */
  persona?: string;
  /** Ids from the skill catalog; defaults to the catalog's default enabled set. */
  skills?: Pick<AgentSkill, 'id' | 'enabled'>[];
  /** Defaults to `~/.agent/agents/<slug-of-name>`. */
  workdir?: string;
  /** 1..200, default 40. */
  maxTurns?: number;
  /** A live department of the workspace; the agent joins its room. */
  departmentId?: string;
  /** Trimmed, at most 80 characters. */
  title?: string;
}

export interface UpdateAgentInput {
  persona?: string;
  skills?: Pick<AgentSkill, 'id' | 'enabled'>[];
  name?: string;
  workdir?: string;
  maxTurns?: number;
  /** Rejected (409) while the agent has open work. */
  computerId?: string;
  /** A live department, or `null` to clear it (the old room is kept). */
  departmentId?: string | null;
  /** Trimmed, at most 80 characters; empty or `null` clears it. */
  title?: string | null;
}

export interface AgentActivity {
  id: string;
  where: string;
  request: string;
  status: 'completed' | 'failed' | 'expired' | 'cancelled';
  at: string;
}
