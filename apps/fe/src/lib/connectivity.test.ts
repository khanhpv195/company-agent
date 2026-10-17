import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  probeDelay,
  reportApiReachable,
  startReachabilityProbe,
  useConnectivity,
} from './connectivity';

afterEach(() => {
  vi.useRealTimers();
  useConnectivity.setState({ apiUnreachable: false });
});

describe('connectivity store', () => {
  it('toggles apiUnreachable', () => {
    reportApiReachable(false);
    expect(useConnectivity.getState().apiUnreachable).toBe(true);
    reportApiReachable(true);
    expect(useConnectivity.getState().apiUnreachable).toBe(false);
  });
});

describe('probeDelay', () => {
  it('backs off from 3s to a 30s cap', () => {
    expect([0, 1, 2, 3, 4, 10].map(probeDelay)).toEqual([3000, 6000, 12000, 24000, 30000, 30000]);
  });
});

describe('startReachabilityProbe', () => {
  it('retries until the API answers, then recovers once', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('down'))
      .mockResolvedValue(new Response('ok'));
    const onRecovered = vi.fn();
    startReachabilityProbe({ url: 'http://x/health', onRecovered, fetchImpl });
    await vi.advanceTimersByTimeAsync(3000);
    expect(onRecovered).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6000);
    expect(onRecovered).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops when cancelled', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    const stop = startReachabilityProbe({ url: 'u', onRecovered: vi.fn(), fetchImpl });
    stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
