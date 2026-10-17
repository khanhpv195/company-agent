import type {
  GatewayAgent,
  GatewayAssignment,
  GatewayEvent,
  GatewayResult,
  PairResponse,
} from './types.js';

export class ApiError extends Error {
  constructor(
    /** HTTP status; 0 = server unreachable. */
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type FetchFn = typeof fetch;

interface Envelope {
  success?: boolean;
  data?: unknown;
  message?: unknown;
}

function parseEnvelope(text: string): Envelope | null {
  try {
    return text ? (JSON.parse(text) as Envelope) : null;
  } catch {
    return null;
  }
}

export interface ClientOptions {
  server: string;
  apiKey?: string;
  fetchImpl?: FetchFn;
  timeoutMs?: number;
}

/** Thin client for the gateway; unwraps the `{ success, data, message }` envelope. */
export class GatewayClient {
  private readonly base: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: FetchFn;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions) {
    this.base = `${opts.server.replace(/\/+$/, '')}/api/v1`;
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  private async request<T>(
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      ...extraHeaders,
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ApiError(
        0,
        `Server unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const text = await res.text();
    const json = parseEnvelope(text);
    if (!res.ok || (json && json.success === false)) {
      const message =
        typeof json?.message === 'string' ? json.message : res.statusText || 'Request failed';
      throw new ApiError(res.status, message);
    }
    return (json?.data ?? null) as T;
  }

  pair(body: {
    code: string;
    name: string;
    os: string;
    cliVersion: string;
  }): Promise<PairResponse> {
    return this.request('/gateway/pair', body);
  }

  heartbeat(
    cliVersion?: string,
    running?: string[],
  ): Promise<{ agents: GatewayAgent[]; cancelled?: string[] }> {
    return this.request('/gateway/heartbeat', { cliVersion, running });
  }

  claim(maxChats?: number): Promise<GatewayAssignment | null> {
    return this.request('/gateway/claim', { maxChats });
  }

  accept(id: string, attempt: number): Promise<{ ok: true }> {
    return this.request(`/gateway/assignments/${id}/accept`, { attempt });
  }

  assignmentHeartbeat(id: string, attempt: number): Promise<{ ok: true; cancelled: boolean }> {
    return this.request(`/gateway/assignments/${id}/heartbeat`, { attempt });
  }

  progress(
    id: string,
    attempt: number,
    events: GatewayEvent[],
  ): Promise<{ ok: true; cancelled: boolean }> {
    return this.request(`/gateway/assignments/${id}/progress`, { attempt, events });
  }

  result(id: string, result: GatewayResult): Promise<{ ok: true }> {
    return this.request(`/gateway/assignments/${id}/result`, result);
  }

  async tool(name: string, assignmentId: string, input: unknown): Promise<unknown> {
    const data = await this.request<{ result: unknown }>(`/gateway/tools/${name}`, input, {
      'x-assignment-id': assignmentId,
    });
    return data?.result ?? null;
  }
}
