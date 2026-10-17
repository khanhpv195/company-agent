import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ClockService } from '../../common/clock';
import { transactionWithEffects } from '../../common/utils';
import { agentConfig, i18nConfig } from '../../config';
import { CHAT_REPLY_REQUESTED_EVENT, type ChatReplyRequestedPayload } from '../chat/chat.constants';
import { ChatService, type ReplyContext } from '../chat/chat.service';
import { ChatMessage } from '../chat/entities/chat-message.entity';
import { ASSIGNMENT_ENDED_EVENT, EventsService, type AssignmentEndedPayload } from '../events';
import { AgentGatewayService } from '../gateway/agent-gateway.service';
import { Random, TaskTimers } from '../tasks/task-timers';
import {
  CHAT_CHUNK_MS,
  CHAT_OFFLINE_MS,
  CHAT_RUN_SECONDS,
  CHAT_STEP_MS,
  demoReplyFor,
} from './chat-script';

/**
 * Stands in for the daemon when a chat message wakes an agent (only with AGENT_SIMULATOR).
 * Port of the FE mock's `runAssignment`, driven through the agent gateway so every state is
 * a real assignment transition:
 *
 *   pending -> (+450 ms) offered -> (+450) claimed -> (+450) running, then the reply streamed in
 *   3-8 character chunks every 28 ms.
 *
 * The agent is a demo: it answers with an honest message saying so (see `chat-script.ts`),
 * with no scripted tool calls and no random failure.
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
    @Inject(i18nConfig.KEY) private readonly i18n: ConfigType<typeof i18nConfig>,
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
      await this.expire(ctx, `${agent.computer.name} offline, không có máy nhận việc`);
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

    const full = demoReplyFor(text, this.i18n.fallbackLanguage);
    const base = await this.chat.loadMessage(messageId);
    let shown = 0;
    while (shown < full.length) {
      // The assignment ended meanwhile (offline expiry, cancel): its message is already failed.
      if (this.ended.has(id)) return;
      shown = Math.min(full.length, shown + 3 + Math.floor(this.random.next() * 6));
      this.chat.publishMessage(workspaceId, { ...base, markdown: full.slice(0, shown) }, memberIds);
      await this.sleep(CHAT_CHUNK_MS);
    }
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      const tx = { manager, effects };
      await this.gateway.progress(id, attempt, [{ kind: 'step', payload: { turns: 1 } }], tx);
      await this.gateway.result(id, attempt, { status: 'completed' }, tx);
      await manager.update(ChatMessage, { id: messageId }, { markdown: full, status: 'complete' });
      const message = await this.chat.loadMessage(messageId, manager);
      effects.push(() => this.chat.publishMessage(workspaceId, message, memberIds));
      await this.recordRun(manager, effects, ctx, text, true);
    });
  }

  /** Expires the reply in one transaction: the assignment and its message together. */
  private async expire(ctx: ReplyContext, error: string): Promise<void> {
    const id = ctx.assignment.id;
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      await this.gateway.expire(id, error, { manager, effects });
      await manager.update(ChatMessage, { id: ctx.message.id }, { status: 'failed' });
      const message = await this.chat.loadMessage(ctx.message.id, manager);
      effects.push(() =>
        this.chat.publishMessage(ctx.assignment.workspaceId, message, ctx.memberIds),
      );
    });
  }

  private recordRun(
    manager: EntityManager,
    effects: Array<() => void>,
    ctx: ReplyContext,
    text: string,
    ok: boolean,
  ): Promise<void> {
    return this.chat.recordRun(manager, effects, ctx, text, ok, CHAT_RUN_SECONDS);
  }
}
