export type ConnectionProvider = 'zalo' | 'facebook' | 'gmail';
export type ReplyMode = 'draft' | 'auto';

/**
 * `simulated`: demo OAuth with a canned conversation (nothing reaches the provider).
 * `unavailable`: the server has provider connections switched off (`CONNECTIONS_MODE=disabled`).
 */
export type ConnectionAvailability = 'simulated' | 'unavailable';

export interface ConnectionAccount {
  name: string;
  detail: string;
}

export interface Connection {
  id: ConnectionProvider;
  name: string;
  shortName: string;
  color: string;
  description: string;
  capabilities: string[];
  permissions: string[];
  accountLabel: string;
  accounts: ConnectionAccount[];
  status: 'off' | 'on';
  account: string | null;
  roomName: string;
  roomId: string | null;
  agentId: string | null;
  mode: ReplyMode;
  /** Always sent by the API; treat a missing value as `simulated`. */
  availability?: ConnectionAvailability;
}

export interface ConnectInput {
  account: string;
  roomName: string;
  agentId: string;
  mode: ReplyMode;
}
