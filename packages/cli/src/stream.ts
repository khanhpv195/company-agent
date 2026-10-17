import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { WORKSPACE_TOOL_PREFIX } from './tools.js';
import type { GatewayEvent, GatewayResult } from './types.js';

export const MAX_OUTPUT_BYTES = 2048;
const MAX_INPUT_CHARS = 200;
/** Tool input fields that carry file bodies: shown as a size, never as content. */
const BULKY_KEYS = new Set(['content', 'new_string', 'old_string']);

function truncate(text: string, max: number): string {
  if (Buffer.byteLength(text) <= max) return text;
  let out = text.slice(0, max);
  while (Buffer.byteLength(out) > max) out = out.slice(0, -1);
  return `${out}…`;
}

function redact(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => [
      k,
      BULKY_KEYS.has(k) && typeof v === 'string' ? `<${v.length} chars>` : v,
    ]),
  );
}

export function shortInput(input: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(redact(input)) ?? '';
  } catch {
    s = String(input);
  }
  return s.length > MAX_INPUT_CHARS ? `${s.slice(0, MAX_INPUT_CHARS)}…` : s;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return content == null ? '' : shortInput(content);
}

export type Outcome = Omit<GatewayResult, 'attempt'>;

/** Maps Agent SDK messages to gateway events and collects the final outcome. */
export class StreamMapper {
  turns = 0;
  private readonly seenMessages = new Set<string>();
  outcome: Outcome | null = null;
  sessionId?: string;
  private readonly tools = new Map<string, { name: string; input: string }>();
  private emittedText = false;
  private pendingBreak = false;

  constructor(private readonly kind: 'chat' | 'task') {}

  map(msg: SDKMessage): GatewayEvent[] {
    const events: GatewayEvent[] = [];
    if ('session_id' in msg && typeof msg.session_id === 'string') this.sessionId = msg.session_id;

    switch (msg.type) {
      case 'stream_event': {
        if (this.kind !== 'chat' || msg.parent_tool_use_id) break;
        const ev = msg.event as {
          type: string;
          content_block?: { type: string };
          delta?: { type: string; text?: string };
        };
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
          this.pendingBreak = this.emittedText;
        } else if (
          ev.type === 'content_block_delta' &&
          ev.delta?.type === 'text_delta' &&
          ev.delta.text
        ) {
          const delta = this.pendingBreak ? `\n\n${ev.delta.text}` : ev.delta.text;
          this.pendingBreak = false;
          this.emittedText = true;
          events.push({ kind: 'text', delta });
        }
        break;
      }
      case 'assistant': {
        // One API turn can arrive as several assistant messages (one per content block)
        // sharing message.id; sub-agent turns (parent_tool_use_id) are not ours.
        const messageId = (msg.message as { id?: string }).id;
        const duplicate = messageId ? this.seenMessages.has(messageId) : false;
        if (messageId) this.seenMessages.add(messageId);
        if (!msg.parent_tool_use_id && !duplicate) {
          this.turns += 1;
          events.push({ kind: 'turns', turns: this.turns });
        }
        for (const block of msg.message.content as Array<{
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
        }>) {
          if (block.type !== 'tool_use' || !block.id || !block.name) continue;
          const name = block.name.startsWith(WORKSPACE_TOOL_PREFIX)
            ? block.name.slice(WORKSPACE_TOOL_PREFIX.length)
            : block.name;
          const input = shortInput(block.input);
          this.tools.set(block.id, { name, input });
          events.push({
            kind: 'tool',
            call: { id: block.id, name, input, output: null, status: 'running' },
          });
        }
        break;
      }
      case 'user': {
        const content = msg.message.content;
        if (!Array.isArray(content)) break;
        for (const block of content as Array<{
          type: string;
          tool_use_id?: string;
          content?: unknown;
          is_error?: boolean;
        }>) {
          if (block.type !== 'tool_result' || !block.tool_use_id) continue;
          const known = this.tools.get(block.tool_use_id) ?? { name: 'tool', input: '' };
          events.push({
            kind: 'tool',
            call: {
              id: block.tool_use_id,
              name: known.name,
              input: known.input,
              output: truncate(resultText(block.content), MAX_OUTPUT_BYTES),
              status: block.is_error ? 'error' : 'ok',
            },
          });
        }
        break;
      }
      case 'result': {
        if (typeof msg.num_turns === 'number') this.turns = msg.num_turns; // authoritative
        const base = {
          sessionId: msg.session_id,
          numTurns: msg.num_turns,
          costUsd: msg.total_cost_usd,
        };
        if (msg.subtype === 'success') {
          this.outcome = msg.is_error
            ? { status: 'failed', error: msg.result || 'agent error', ...base }
            : { status: 'completed', text: msg.result, ...base };
        } else {
          const errors = msg.errors?.filter(Boolean) ?? [];
          this.outcome = {
            status: 'failed',
            error: errors.length ? errors.join('; ') : msg.subtype,
            ...base,
          };
        }
        break;
      }
      default:
        break;
    }
    return events;
  }
}

/** Merge adjacent text deltas so one flush carries one text event. */
export function coalesce(events: GatewayEvent[]): GatewayEvent[] {
  const out: GatewayEvent[] = [];
  for (const ev of events) {
    const last = out[out.length - 1];
    if (ev.kind === 'text' && last?.kind === 'text') last.delta += ev.delta;
    else if (ev.kind === 'turns' && last?.kind === 'turns') last.turns = ev.turns;
    else out.push({ ...ev });
  }
  return out;
}
