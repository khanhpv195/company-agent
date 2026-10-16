export interface DailyAssignments {
  date: string;
  completed: number;
  failed: number;
}

export interface AttentionItem {
  id: string;
  kind: 'error' | 'warning' | 'offline';
  title: string;
  meta: string;
  action: string;
  /** Task the action applies to, if any. */
  taskId: string | null;
  resolved: boolean;
}

export interface FeedItem {
  id: string;
  /** Member or agent id. */
  by: string;
  /** Inline markdown. */
  text: string;
  at: string;
}

export interface DashboardSummary {
  days: DailyAssignments[];
  byAgent: { agentId: string; count: number }[];
  minutesToday: number;
  attention: AttentionItem[];
  feed: FeedItem[];
}
