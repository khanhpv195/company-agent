import type { Agent } from '@repo/shared';

export type Presence = 'on' | 'off' | 'busy';

export const agentPresence = (status: Agent['status']): Presence =>
  status === 'offline' ? 'off' : status === 'working' ? 'busy' : 'on';
