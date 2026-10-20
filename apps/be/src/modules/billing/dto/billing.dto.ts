import { ApiProperty } from '@nestjs/swagger';
import type { BillingUrlResult, CheckoutInput, WorkspacePlan } from '@repo/shared';
import { IsIn } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

const PAID_PLANS = ['pro', 'team'] as const;
const PLANS = ['free', 'pro', 'team'] as const;

export class CheckoutDto implements CheckoutInput {
  @ApiProperty({ enum: PAID_PLANS })
  @IsIn(PAID_PLANS, { message: i18nValidationMessage('validation.IS_ENUM') })
  plan: (typeof PAID_PLANS)[number];
}

export class BillingUrlDto implements BillingUrlResult {
  @ApiProperty({ description: 'Stripe-hosted page to send the owner to' })
  url: string;
}

class CountsDto {
  @ApiProperty() seats: number;
  @ApiProperty() agents: number;
  @ApiProperty() computers: number;
}

class PeriodDto {
  @ApiProperty({ description: 'ISO, inclusive' }) start: string;
  @ApiProperty({ description: 'ISO, exclusive' }) end: string;
}

class ByAgentDto {
  @ApiProperty() agentId: string;
  @ApiProperty() name: string;
  @ApiProperty() costUsd: number;
  @ApiProperty() runs: number;
}

class ByDayDto {
  @ApiProperty({ example: '2026-10-17' }) date: string;
  @ApiProperty() costUsd: number;
  @ApiProperty() runs: number;
}

class SubscriptionDto {
  @ApiProperty({ enum: ['active', 'trialing', 'past_due', 'canceled', 'incomplete'] })
  status: string;
  @ApiProperty({ type: String, nullable: true }) currentPeriodEnd: string | null;
  @ApiProperty() cancelAtPeriodEnd: boolean;
}

export class BillingSummaryDto {
  @ApiProperty({ enum: PLANS }) plan: WorkspacePlan;
  @ApiProperty({ type: CountsDto }) limits: CountsDto;
  @ApiProperty({ type: CountsDto }) usage: CountsDto;
  @ApiProperty({ type: PeriodDto }) period: PeriodDto;
  @ApiProperty() costUsd: number;
  @ApiProperty() runs: number;
  @ApiProperty({ type: [ByAgentDto] }) byAgent: ByAgentDto[];
  @ApiProperty({ type: [ByDayDto] }) byDay: ByDayDto[];
  @ApiProperty({ type: SubscriptionDto, nullable: true }) subscription: SubscriptionDto | null;
  @ApiProperty() checkoutAvailable: boolean;
  @ApiProperty({ description: 'False when plan limits are off (BILLING_LIMITS_ENABLED).' })
  limitsEnabled: boolean;
}
