import type { AgentStatus, ComputerStatus } from '@repo/shared';

/** Port of the FE mock `syncAgents`: offline beats working beats idle. */
export const deriveAgentStatus = (computerStatus: ComputerStatus, busy: boolean): AgentStatus => {
  if (computerStatus !== 'online') return 'offline';
  return busy ? 'working' : 'idle';
};
