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
}

export interface UpdateAgentInput {
  persona?: string;
  skills?: Pick<AgentSkill, 'id' | 'enabled'>[];
}

export interface AgentActivity {
  id: string;
  where: string;
  request: string;
  status: 'completed' | 'failed' | 'expired' | 'cancelled';
  at: string;
}
