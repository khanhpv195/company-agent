import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { vi } from 'vitest';
import type { GatewayAssignment } from '../src/types.js';

export function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: status < 400, data, message: 'ok' }), { status });
}

export function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ success: false, data: null, message }), { status });
}

export interface Call {
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** Fake fetch: routes by path suffix, records every call. */
export function fakeFetch(handlers: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const full = String(url);
    const path = full.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
    const call: Call = {
      path,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      ),
    };
    calls.push(call);
    const key = Object.keys(handlers).find((k) => path === k || path.endsWith(k));
    if (!key) return errorResponse(404, `no handler for ${path}`);
    return handlers[key](call);
  });
  return { fetchImpl: fn as unknown as typeof fetch, calls };
}

export function assignment(over: Partial<GatewayAssignment> = {}): GatewayAssignment {
  return {
    id: 'as-1',
    attempt: 1,
    kind: 'chat',
    agent: { id: 'ag-1', name: 'Hana', persona: 'Be brief.', workdir: '', maxTurns: 5, skills: [] },
    session: { id: '11111111-1111-4111-8111-111111111111', resume: false },
    prompt: 'hello',
    context: 'ctx',
    requestedBy: { id: 'm-1', name: 'Khanh', role: 'admin' },
    leaseMs: 30000,
    ...over,
  };
}

export const sdkMsg = (m: unknown) => m as SDKMessage;

export const textDelta = (text: string) =>
  sdkMsg({
    type: 'stream_event',
    parent_tool_use_id: null,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  });

export const textStart = () =>
  sdkMsg({
    type: 'stream_event',
    parent_tool_use_id: null,
    event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  });

export const toolUse = (id: string, name: string, input: unknown) =>
  sdkMsg({
    type: 'assistant',
    parent_tool_use_id: null,
    session_id: 's',
    message: { content: [{ type: 'tool_use', id, name, input }] },
  });

export const toolResult = (id: string, content: unknown, isError = false) =>
  sdkMsg({
    type: 'user',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
  });

export const success = (result: string) =>
  sdkMsg({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    session_id: 'sess-1',
    num_turns: 2,
    total_cost_usd: 0.0123,
    errors: [],
  });
