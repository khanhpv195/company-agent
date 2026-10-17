import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import type { ToolCall } from '@repo/shared';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ClockService } from '../../common/clock';
import { transactionWithEffects } from '../../common/utils';
import { agentConfig } from '../../config';
import { AgentActivity } from '../agents/entities/agent-activity.entity';
import {
  CHAT_REPLY_REQUESTED_EVENT,
  CHAT_RUN_ENDED_EVENT,
  type ChatReplyRequestedPayload,
  type ChatRunEndedPayload,
} from '../chat/chat.constants';
import { previewOf } from '../chat/chat.util';
import { ChatService, type ReplyContext } from '../chat/chat.service';
import { ChatMessage } from '../chat/entities/chat-message.entity';
import { ASSIGNMENT_ENDED_EVENT, EventsService, type AssignmentEndedPayload } from '../events';
import { AgentGatewayService } from '../gateway/agent-gateway.service';
import { Random, TaskTimers } from '../tasks/task-timers';
import {
  CHAT_CHUNK_MS,
  CHAT_FAIL_ERROR,
  CHAT_FAIL_RATE,
  CHAT_OFFLINE_MS,
  CHAT_RUN_SECONDS,
  CHAT_STEP_MS,
  CHAT_TOOL_MS,
  replyFor,
  toolCallsFor,
} from './chat-script';

/**
 * Stands in for the daemon when a chat message wakes an agent (only with AGENT_SIMULATOR).
 * Port of the FE mock's `runAssignment`, driven through the agent gateway so every state is
 * a real assignment transition:
 *
 *   pending -> (+450 ms) offered -> (+450) claimed -> (+450) running, two tool calls (900 ms
 *   each), then either a 8 % failure or the reply streamed in 3-8 character chunks every 28 ms.
 *
 * Streamed chunks are only published (from memory, nothing is written); the final markdown,
 * `complete` status, turns and the `completed` result are committed once. A computer that is
 * not online lets the assignment expire after 1.2 s. Delays use `TaskTimers` and randomness
 * `Random`, so tests drive it without sleeping.
 *
 * Without the simulator a reply simply stays `pending` until a real daemon takes it.
 */
@Injectable()
export class SimulatorChatRunner {
  private readonly logger = new Logger(SimulatorChatRunner.name);
  private readonly inFlight = new Set<Promise<void>>();
  /** Chat assignments that ended behind the runner's back (expiry, cancel): stop streaming. */
  private readonly ended = new Set<string>();

  constructor(
    @Inject(agentConfig.KEY) private readonly config: ConfigType<typeof agentConfig>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly chat: ChatService,
    private readonly gateway: AgentGatewayService,
    private readonly events: EventsService,
    private readonly emitter: EventEmitter2,
    private readonly timers: TaskTimers,
    private readonly random: Random,
    private readonly clock: ClockService,
  ) {}

  @OnEvent(CHAT_REPLY_REQUESTED_EVENT)
  onReplyRequested(payload: ChatReplyRequestedPayload): void {
    if (this.config.simulator) void this.start(payload.assignmentId);
  }

  @OnEvent(ASSIGNMENT_ENDED_EVENT)
  onAssignmentEnded(payload: AssignmentEndedPayload): void {
    if (payload.sourceKind === 'chat' && this.inFlight.size) this.ended.add(payload.assignmentId);
  }

  /** Runs one reply in the background; the promise resolves when it is over. */
  start(assignmentId: string): Promise<void> {
    const run = this.runAssignment(assignmentId)
      .catch((error: unknown) =>
        this.logger.error(
          `Simulated chat reply ${assignmentId} failed`,
          error instanceof Error ? error.stack : String(error),
        ),
      )
      .finally(() => {
        this.inFlight.delete(run);
        this.ended.delete(assignmentId);
      });
    this.inFlight.add(run);
    return run;
  }

  /** Number of replies still running (tests wait for 0). */
  get active(): number {
    return this.inFlight.size;
  }

  async runAssignment(assignmentId: string): Promise<void> {
    const ctx = await this.chat.replyContext(assignmentId);
    if (!ctx || ctx.assignment.status !== 'pending') return;
    try {
      await this.drive(ctx);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        // The assignment moved on (expired by a restart, cancelled): nothing left to drive.
        this.logger.debug(`Chat reply ${assignmentId} was interrupted`);
        return;
      }
      // Unexpected: end the assignment so the message does not stay streaming.
      await this.gateway.expire(assignmentId, 'Simulator error').catch(() => undefined);
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.timers.later(ms, resolve));
  }

  private async drive(ctx: ReplyContext): Promise<void> {
    const { agent, memberIds } = ctx;
    const id = ctx.assignment.id;
    const workspaceId = ctx.assignment.workspaceId;
    const messageId = ctx.message.id;
    const text = ctx.assignment.activation ?? '';
    const publish = async (): Promise<void> =>
      this.chat.publishMessage(workspaceId, await this.chat.loadMessage(messageId), memberIds);

    if (agent.computer.status !== 'online') {
      await this.sleep(CHAT_OFFLINE_MS);
      await this.fail(ctx, 'expire', `${agent.computer.name} offline, không có máy nhận việc`, 0);
      return;
    }

    await this.sleep(CHAT_STEP_MS);
    await this.gateway.offer(id);
    await publish();
    await this.sleep(CHAT_STEP_MS);
    const claimed = await this.gateway.claimById(id, ctx.assignment.computerId);
    await publish();
    await this.sleep(CHAT_STEP_MS);
    await this.gateway.accept(id, claimed.attempt);
    await publish();
    this.events.publish(workspaceId, { type: 'agents.changed' });
    const attempt = claimed.attempt;

    for (const spec of toolCallsFor(text)) {
      const call: ToolCall = { id: randomUUID(), ...spec, status: 'running' };
      await this.gateway.progress(id, attempt, [{ kind: 'tool', payload: call }]);
      await publish();
      await this.sleep(CHAT_TOOL_MS);
      await this.gateway.progress(id, attempt, [
        { kind: 'tool', payload: { ...call, status: 'ok' } satisfies ToolCall },
      ]);
      await publish();
    }

    const failed = this.random.next() < CHAT_FAIL_RATE;
    if (failed) {
      await this.fail(ctx, 'result', CHAT_FAIL_ERROR, attempt, text);
    } else {
      const full = replyFor(text);
      const base = await this.chat.loadMessage(messageId);
      let shown = 0;
      while (shown < full.length) {
        // The assignment ended meanwhile (offline expiry, cancel): its message is already failed.
        if (this.ended.has(id)) return;
        shown = Math.min(full.length, shown + 3 + Math.floor(this.random.next() * 6));
        this.chat.publishMessage(
          workspaceId,
          { ...base, markdown: full.slice(0, shown) },
          memberIds,
        );
        await this.sleep(CHAT_CHUNK_MS);
      }
      await transactionWithEffects(this.dataSource, async (manager, effects) => {
        const tx = { manager, effects };
        await this.gateway.progress(id, attempt, [{ kind: 'step', payload: { turns: 2 } }], tx);
        await this.gateway.result(id, attempt, { status: 'completed' }, tx);
        await manager.update(
          ChatMessage,
          { id: messageId },
          { markdown: full, status: 'complete' },
        );
        const message = await this.chat.loadMessage(messageId, manager);
        effects.push(() => this.chat.publishMessage(workspaceId, message, memberIds));
        await this.recordRun(manager, effects, ctx, text, true);
      });
    }
  }

  /** Ends the reply as failed in one transaction: the assignment and its message together. */
  private async fail(
    ctx: ReplyContext,
    how: 'expire' | 'result',
    error: string,
    attempt: number,
    runText?: string,
  ): Promise<void> {
    const id = ctx.assignment.id;
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      const tx = { manager, effects };
      if (how === 'expire') await this.gateway.expire(id, error, tx);
      else await this.gateway.result(id, attempt, { status: 'failed', error }, tx);
      await manager.update(ChatMessage, { id: ctx.message.id }, { status: 'failed' });
      const message = await this.chat.loadMessage(ctx.message.id, manager);
      effects.push(() =>
        this.chat.publishMessage(ctx.assignment.workspaceId, message, ctx.memberIds),
      );
      if (runText !== undefined) await this.recordRun(manager, effects, ctx, runText, false);
    });
  }

  /**
   * Activity log entry (inside the run's final transaction), then after commit the domain event
   * Phase 6 listens to and the "something changed" pings.
   */
  private async recordRun(
    manager: EntityManager,
    effects: Array<() => void>,
    ctx: ReplyContext,
    text: string,
    ok: boolean,
  ): Promise<void> {
    const workspaceId = ctx.assignment.workspaceId;
    // A DM is private to its member: the activity log and the feed get a neutral line only.
    const dm = ctx.chat.kind === 'dm';
    const preview = dm ? '' : previewOf(text);
    await manager.getRepository(AgentActivity).insert({
      workspaceId,
      agentId: ctx.agent.id,
      location: ctx.where,
      request: dm ? 'Tin nhắn riêng (DM)' : preview,
      status: ok ? 'completed' : 'failed',
      at: this.clock.now(),
    });
    effects.push(() => {
      const payload: ChatRunEndedPayload = {
        workspaceId,
        agentId: ctx.agent.id,
        ok,
        durationSec: CHAT_RUN_SECONDS,
        preview,
        dm,
      };
      this.emitter.emit(CHAT_RUN_ENDED_EVENT, payload);
      this.events.publish(workspaceId, { type: 'agents.changed' });
      this.chat.publishRoomsChanged(workspaceId, ctx.memberIds);
    });
  }
}
