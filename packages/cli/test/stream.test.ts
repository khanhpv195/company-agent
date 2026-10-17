import { describe, expect, it } from 'vitest';
import { coalesce, MAX_OUTPUT_BYTES, StreamMapper } from '../src/stream.js';
import { sdkMsg, success, textDelta, textStart, toolResult, toolUse } from './helpers.js';

describe('StreamMapper', () => {
  it('streams text deltas for chat, separating text blocks with a blank line', () => {
    const m = new StreamMapper('chat');
    const events = [
      textStart(),
      textDelta('Hi'),
      textDelta(' there'),
      textStart(),
      textDelta('Done'),
    ].flatMap((x) => m.map(x));
    expect(coalesce(events)).toEqual([{ kind: 'text', delta: 'Hi there\n\nDone' }]);
  });

  it('does not stream text for tasks and ignores sub-agent text', () => {
    expect(new StreamMapper('task').map(textDelta('x'))).toEqual([]);
    const sub = sdkMsg({
      type: 'stream_event',
      parent_tool_use_id: 'tu',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } },
    });
    expect(new StreamMapper('chat').map(sub)).toEqual([]);
  });

  it('maps tool_use to running and tool_result to ok/error with the same id', () => {
    const m = new StreamMapper('chat');
    const running = m.map(toolUse('t1', 'mcp__workspace__list_tasks', { status: 'review' }));
    expect(running).toEqual([
      { kind: 'turns', turns: 1 },
      {
        kind: 'tool',
        call: {
          id: 't1',
          name: 'list_tasks',
          input: '{"status":"review"}',
          output: null,
          status: 'running',
        },
      },
    ]);
    expect(m.map(toolResult('t1', [{ type: 'text', text: '[]' }]))).toEqual([
      {
        kind: 'tool',
        call: {
          id: 't1',
          name: 'list_tasks',
          input: '{"status":"review"}',
          output: '[]',
          status: 'ok',
        },
      },
    ]);
    const err = m.map(toolResult('t1', 'boom', true));
    expect(err[0]).toMatchObject({ call: { status: 'error', output: 'boom' } });
  });

  it('truncates tool output to 2 KB', () => {
    const m = new StreamMapper('task');
    m.map(toolUse('t', 'Read', { file_path: 'a' }));
    const [ev] = m.map(toolResult('t', 'é'.repeat(5000)));
    const out = (ev as { call: { output: string } }).call.output;
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES + 3);
    expect(out.endsWith('…')).toBe(true);
  });

  it('records success and error outcomes with session, turns and cost', () => {
    const ok = new StreamMapper('chat');
    ok.map(success('final'));
    expect(ok.outcome).toEqual({
      status: 'completed',
      text: 'final',
      sessionId: 'sess-1',
      numTurns: 2,
      costUsd: 0.0123,
    });

    const bad = new StreamMapper('task');
    bad.map(
      sdkMsg({
        type: 'result',
        subtype: 'error_max_turns',
        errors: [],
        session_id: 's',
        num_turns: 5,
        total_cost_usd: 1,
      }),
    );
    expect(bad.outcome).toMatchObject({ status: 'failed', error: 'error_max_turns', numTurns: 5 });

    const withErrors = new StreamMapper('task');
    withErrors.map(
      sdkMsg({
        type: 'result',
        subtype: 'error_during_execution',
        errors: ['a', 'b'],
        session_id: 's',
        num_turns: 1,
        total_cost_usd: 0,
      }),
    );
    expect(withErrors.outcome?.error).toBe('a; b');

    const isErr = new StreamMapper('chat');
    isErr.map(
      sdkMsg({
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'API down',
        session_id: 's',
        num_turns: 0,
        total_cost_usd: 0,
      }),
    );
    expect(isErr.outcome).toMatchObject({ status: 'failed', error: 'API down' });
  });
});

describe('StreamMapper turns and input redaction', () => {
  it('counts one turn per message id, ignores sub-agents, prefers result.num_turns', () => {
    const m = new StreamMapper('task');
    const asst = (id: string, parent: string | null = null) =>
      sdkMsg({
        type: 'assistant',
        parent_tool_use_id: parent,
        session_id: 's',
        message: { id, content: [{ type: 'text', text: 'x' }] },
      });
    m.map(asst('m1'));
    m.map(asst('m1')); // same API message, second content block
    m.map(asst('m2'));
    m.map(asst('sub', 'tool-1'));
    expect(m.turns).toBe(2);
    m.map(success('done')); // num_turns: 2 in the helper
    expect(m.turns).toBe(2);
  });

  it('redacts file bodies and caps tool input at 200 chars', () => {
    const m = new StreamMapper('task');
    const events = m.map(
      toolUse('t1', 'Write', { file_path: '/w/a.txt', content: 'secret'.repeat(100) }),
    );
    const call = (events.find((e) => e.kind === 'tool') as { call: { input: string } }).call;
    expect(call.input).toContain('<600 chars>');
    expect(call.input).not.toContain('secret');
    const long = m.map(toolUse('t2', 'Bash', { command: 'x'.repeat(1000) }));
    const input = (long.find((e) => e.kind === 'tool') as { call: { input: string } }).call.input;
    expect(input.length).toBeLessThanOrEqual(201);
  });
});
