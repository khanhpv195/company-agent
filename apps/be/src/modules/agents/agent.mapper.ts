import type { Agent as AgentContract, AgentActivity as AgentActivityContract } from '@repo/shared';
import { deriveAgentStatus } from './agent-status.util';
import { AgentActivity } from './entities/agent-activity.entity';
import { Agent } from './entities/agent.entity';

/** `agent.computer` must be loaded: the derived status depends on it. */
export const toAgent = (agent: Agent, busy: boolean): AgentContract => ({
  id: agent.id,
  name: agent.name,
  avatar: agent.avatar,
  provider: agent.provider as AgentContract['provider'],
  computerId: agent.computerId,
  persona: agent.persona,
  skills: agent.skills.map(({ id, name, enabled }) => ({ id, name, enabled })),
  workdir: agent.workdir,
  maxTurns: agent.maxTurns,
  status: deriveAgentStatus(agent.computer.status, busy),
  simulated: agent.computer.simulated,
});

export const toAgentActivity = (row: AgentActivity): AgentActivityContract => ({
  id: row.id,
  where: row.location,
  request: row.request,
  status: row.status,
  at: row.at.toISOString(),
});
