import { ConfigType, registerAs } from '@nestjs/config';

export const agentConfig = registerAs('agent', () => ({
  simulator: process.env.AGENT_SIMULATOR === 'true',
  reconcileEnabled: process.env.RECONCILE_ENABLED !== 'false',
}));

export type AgentConfig = ConfigType<typeof agentConfig>;
