import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ApiWrappedResponse,
  CurrentAuth,
  Public,
  ResponseMessage,
  Roles,
} from '../../common/decorators';
import type { AuthContext } from '../../common/types';
import { BillingWebhookService } from './billing-webhook.service';
import { BillingService } from './billing.service';
import { BillingSummaryDto, BillingUrlDto, CheckoutDto } from './dto/billing.dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly webhook: BillingWebhookService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @ResponseMessage('billing.LOADED')
  @ApiOperation({ summary: 'Plan, limits, usage and this month cost (any member)' })
  @ApiWrappedResponse(BillingSummaryDto)
  summary(@CurrentAuth() auth: AuthContext) {
    return this.billing.summary(auth.workspaceId);
  }

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Roles('owner')
  @ResponseMessage('billing.CHECKOUT_CREATED')
  @ApiOperation({ summary: 'Start a Stripe Checkout subscription (owner)' })
  @ApiWrappedResponse(BillingUrlDto)
  checkout(@CurrentAuth() auth: AuthContext, @Body() dto: CheckoutDto) {
    return this.billing.checkout(auth, dto);
  }

  @Post('portal')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Roles('owner')
  @ResponseMessage('billing.PORTAL_CREATED')
  @ApiOperation({ summary: 'Open the Stripe customer portal (owner)' })
  @ApiWrappedResponse(BillingUrlDto)
  portal(@CurrentAuth() auth: AuthContext) {
    return this.billing.portal(auth);
  }

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('billing.WEBHOOK_RECEIVED')
  @ApiOperation({ summary: 'Stripe webhook (public, verified by signature)' })
  @ApiWrappedResponse(null)
  async stripeWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<null> {
    await this.webhook.handle(req.rawBody, signature);
    return null;
  }
}
