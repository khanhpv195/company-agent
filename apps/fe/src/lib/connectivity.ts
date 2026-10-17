import { create } from 'zustand';

interface ConnectivityState {
  /** The last API call failed at the network level (ApiError status 0). */
  apiUnreachable: boolean;
  /** `navigator.onLine` is false. */
  browserOffline: boolean;
}

export const useConnectivity = create<ConnectivityState>()(() => ({
  apiUnreachable: false,
  browserOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
}));

/** Called by the api client: true after any HTTP response, false after a network failure. */
export const reportApiReachable = (reachable: boolean): void => {
  if (useConnectivity.getState().apiUnreachable === !reachable) return;
  useConnectivity.setState({ apiUnreachable: !reachable });
};

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => useConnectivity.setState({ browserOffline: true }));
  window.addEventListener('online', () => useConnectivity.setState({ browserOffline: false }));
}

/** Delay before probe attempt `attempt` (0-based): 3s, 6s, 12s, 24s, then 30s. */
export const probeDelay = (attempt: number): number => Math.min(3000 * 2 ** attempt, 30000);

/** The API answered (any HTTP response), so clear both flags. */
export const markReachable = (): void => {
  reportApiReachable(true);
  if (
    useConnectivity.getState().browserOffline &&
    typeof navigator !== 'undefined' &&
    navigator.onLine !== false
  )
    useConnectivity.setState({ browserOffline: false });
};

/**
 * Polls `url` with backoff until it answers, then calls `onRecovered`. Works with no active
 * queries. Returns a stop function. Never use in mock mode.
 */
export function startReachabilityProbe(opts: {
  url: string;
  onRecovered: () => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): () => void {
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  const run = async () => {
    timer = null;
    controller = new AbortController();
    const kill = setTimeout(() => controller?.abort(), opts.timeoutMs ?? 5000);
    try {
      await (opts.fetchImpl ?? fetch)(opts.url, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(kill);
      if (stopped) return;
      stopped = true;
      opts.onRecovered();
    } catch {
      clearTimeout(kill);
      if (stopped) return;
      timer = setTimeout(() => void run(), probeDelay(attempt++));
    }
  };
  timer = setTimeout(() => void run(), probeDelay(attempt++));
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
  };
}
