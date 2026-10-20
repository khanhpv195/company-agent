import type { Agent as AgentContract, AgentActivity as AgentActivityContract } from '@repo/shared';
import type { SkillRef } from '../skills/skill-access';
import { deriveAgentStatus } from './agent-status.util';
import { AgentActivity } from './entities/agent-activity.entity';
import { Agent } from './entities/agent.entity';

/**
 * `agent.computer` must be loaded: the derived status depends on it. `library` is every live
 * skill of the workspace, sorted by name: the agent lists all of them, with the flag for its own.
 */
export const toAgent = (
  agent: Agent,
  busy: boolean,
  library: readonly Pick<SkillRef, 'id' | 'name'>[],
): AgentContract => ({
  id: agent.id,
  name: agent.name,
  avatar: agent.avatar,
  provider: agent.provider as AgentContract['provider'],
  computerId: agent.computerId,
  persona: agent.persona,
  skills: library.map(({ id, name }) => ({ id, name, enabled: agent.skills.includes(id) })),
  workdir: agent.workdir,
  maxTurns: agent.maxTurns,
  status: deriveAgentStatus(agent.computer.status, busy),
  simulated: agent.computer.simulated,
  departmentId: agent.departmentId,
  title: agent.title,
});

export const toAgentActivity = (row: AgentActivity): AgentActivityContract => ({
  id: row.id,
  where: row.location,
  request: row.request,
  status: row.status,
  at: row.at.toISOString(),
});
