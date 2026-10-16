export type ComputerStatus = 'online' | 'offline' | 'sleeping';

export interface Computer {
  id: string;
  name: string;
  os: string;
  status: ComputerStatus;
  lastHeartbeatAt: string;
  keepAwake: boolean;
  cliVersion: string;
}
