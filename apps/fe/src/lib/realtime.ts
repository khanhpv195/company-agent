import type { RealtimeEvent } from '@repo/shared';
import { MOCK } from './api-client';

export interface RealtimeClient {
  subscribe(handler: (event: RealtimeEvent) => void): () => void;
}

/** No server push yet outside mock mode; an SSE client plugs in here later. */
const idle: RealtimeClient = { subscribe: () => () => {} };

export async function connectRealtime(): Promise<RealtimeClient> {
  if (!MOCK) return idle;
  const { mockRealtime } = await import('../mocks/server');
  return mockRealtime;
}
