export type ComputerStatus = 'online' | 'offline' | 'sleeping';

export interface Computer {
  id: string;
  name: string;
  os: string;
  status: ComputerStatus;
  lastHeartbeatAt: string;
  keepAwake: boolean;
  cliVersion: string;
  /** Demo machine driven by the in-app simulator (no real daemon). */
  simulated: boolean;
  /** Set when the computer was revoked (its key no longer works). */
  revokedAt: string | null;
}
