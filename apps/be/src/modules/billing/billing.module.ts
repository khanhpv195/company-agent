import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { billingConfig } from '../../config';
import { BillingWebhookService } from './billing-webhook.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { SeatSyncService } from './seat-sync.service';
import { PlanLimitsService } from './plan-limits.service';
import { DisabledStripeGateway, StripeGateway, StripeSdkGateway } from './stripe.gateway';

/** Plan limits (used by team, agents and daemon), the billing summary and Stripe. */
@Module({
  controllers: [BillingController],
  providers: [
    PlanLimitsService,
    SeatSyncService,
    BillingService,
    BillingWebhookService,
    {
      provide: StripeGateway,
      inject: [billingConfig.KEY],
      useFactory: (config: ConfigType<typeof billingConfig>): StripeGateway =>
        config.provider === 'stripe' ? new StripeSdkGateway(config) : new DisabledStripeGateway(),
    },
  ],
  exports: [PlanLimitsService, SeatSyncService, StripeGateway],
})
export class BillingModule {}
