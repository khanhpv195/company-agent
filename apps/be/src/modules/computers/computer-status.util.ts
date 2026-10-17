/** True when the last heartbeat is older than `timeoutMs` at `now`. */
export const isHeartbeatStale = (lastHeartbeatAt: Date, now: Date, timeoutMs: number): boolean =>
  now.getTime() - lastHeartbeatAt.getTime() > timeoutMs;
