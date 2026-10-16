export type ConnectionProvider = 'zalo' | 'facebook' | 'gmail';
export type ReplyMode = 'draft' | 'auto';

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
}

export interface ConnectInput {
  account: string;
  roomName: string;
  agentId: string;
  mode: ReplyMode;
}
