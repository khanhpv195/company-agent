import type { Computer as ComputerContract } from '@repo/shared';
import { Computer } from './entities/computer.entity';

/** Explicit field picks: the api key hash never leave the server. */
export const toComputer = (computer: Computer): ComputerContract => ({
  id: computer.id,
  name: computer.name,
  os: computer.os,
  status: computer.status,
  lastHeartbeatAt: computer.lastHeartbeatAt.toISOString(),
  keepAwake: computer.keepAwake,
  cliVersion: computer.cliVersion,
  simulated: computer.simulated,
  revokedAt: computer.revokedAt?.toISOString() ?? null,
});
