/** Internal domain events of the computers module (never sent to clients). */
export const COMPUTER_OFFLINE_EVENT = 'computer.offline';
export const COMPUTER_ONLINE_EVENT = 'computer.online';

export interface ComputerStatusPayload {
  workspaceId: string;
  computerId: string;
  name: string;
}
