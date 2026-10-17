export type AssignmentStatus =
  'pending' | 'offered' | 'claimed' | 'running' | 'completed' | 'failed' | 'expired' | 'cancelled';

export interface ToolCall {
  id: string;
  name: string;
  input: string;
  output: string | null;
  status: 'running' | 'ok' | 'error';
}

export interface Assignment {
  id: string;
  agentId: string;
  status: AssignmentStatus;
  toolCalls: ToolCall[];
  turns: number;
  /** Reported by a real daemon when the run ends; null while running or for simulated runs. */
  costUsd: number | null;
  error: string | null;
}

export type MessageAuthor =
  | { kind: 'human'; id: string }
  | { kind: 'agent'; id: string }
  | { kind: 'external'; connectionId: string; name: string };

export interface MessageDraft {
  connectionId: string;
  state: 'pending' | 'sent';
}

export interface Message {
  id: string;
  chatId: string;
  author: MessageAuthor;
  createdAt: string;
  status: 'streaming' | 'complete' | 'failed';
  markdown: string;
  assignment: Assignment | null;
  /** Reply to an external channel that waits for a human before it is sent. */
  draft: MessageDraft | null;
}

export interface SendMessageInput {
  markdown: string;
  /** Agent to wake up; the server also detects @mentions in the text. */
  agentId?: string;
}
