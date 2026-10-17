import Stripe from 'stripe';
import { StripeSdkGateway } from './stripe.gateway';

type Mock = { retrieve: jest.Mock; cancel: jest.Mock };

function make(): { gateway: StripeSdkGateway; mock: Mock } {
  const gateway = new StripeSdkGateway({
    provider: 'stripe',
    stripe: { secretKey: 'sk_test_unit', webhookSecret: 'whsec', pricePro: 'p', priceTeam: 't' },
  } as never);
  const mock: Mock = { retrieve: jest.fn(), cancel: jest.fn() };
  (gateway as unknown as { stripe: unknown }).stripe = { subscriptions: mock };
  return { gateway, mock };
}

const missing = () =>
  new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    code: 'resource_missing',
    message: 'No such subscription',
  });

describe('StripeSdkGateway.cancelSubscription', () => {
  it('cancels a live subscription', async () => {
    const { gateway, mock } = make();
    mock.retrieve.mockResolvedValue({ status: 'active' });
    mock.cancel.mockResolvedValue({});
    await gateway.cancelSubscription('sub_1');
    expect(mock.cancel).toHaveBeenCalledWith('sub_1');
  });

  it('treats an already canceled subscription as success', async () => {
    const { gateway, mock } = make();
    mock.retrieve.mockResolvedValue({ status: 'canceled' });
    await gateway.cancelSubscription('sub_1');
    expect(mock.cancel).not.toHaveBeenCalled();
  });

  it('treats resource_missing as success', async () => {
    const { gateway, mock } = make();
    mock.retrieve.mockResolvedValue({ status: 'active' });
    mock.cancel.mockRejectedValue(missing());
    await expect(gateway.cancelSubscription('sub_1')).resolves.toBeUndefined();
  });

  it('rethrows other errors', async () => {
    const { gateway, mock } = make();
    mock.retrieve.mockRejectedValue(new Error('network'));
    await expect(gateway.cancelSubscription('sub_1')).rejects.toThrow('network');
  });
});
