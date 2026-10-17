import { ApiProperty } from '@nestjs/swagger';
import type { AttentionItem, DailyAssignments, DashboardSummary, FeedItem } from '@repo/shared';

export class DailyAssignmentsDto implements DailyAssignments {
  @ApiProperty({ example: '2026-03-11', description: 'Local day (workspace timezone)' })
  date: string;

  @ApiProperty()
  completed: number;

  @ApiProperty()
  failed: number;
}

export class AgentCountDto {
  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty()
  count: number;
}

export class AttentionItemDto implements AttentionItem {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['error', 'warning', 'offline'] })
  kind: AttentionItem['kind'];

  @ApiProperty()
  title: string;

  @ApiProperty()
  meta: string;

  @ApiProperty()
  action: string;

  @ApiProperty({ type: String, nullable: true })
  taskId: string | null;

  @ApiProperty()
  resolved: boolean;
}

export class FeedItemDto implements FeedItem {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Member or agent id' })
  by: string;

  @ApiProperty({ description: 'Inline markdown' })
  text: string;

  @ApiProperty({ format: 'date-time' })
  at: string;
}

export class DashboardSummaryDto implements DashboardSummary {
  @ApiProperty({ type: [DailyAssignmentsDto], description: 'Last 14 local days, oldest first' })
  days: DailyAssignmentsDto[];

  @ApiProperty({ type: [AgentCountDto], description: 'Finished work per agent, busiest first' })
  byAgent: AgentCountDto[];

  @ApiProperty()
  minutesToday: number;

  @ApiProperty({ type: [AttentionItemDto], description: 'Open items, newest first' })
  attention: AttentionItemDto[];

  @ApiProperty({ type: [FeedItemDto], description: 'The latest 8 events' })
  feed: FeedItemDto[];
}
