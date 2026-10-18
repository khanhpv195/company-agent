import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { ToolCall } from '@repo/shared';
import { isUUID } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, IsNull, MoreThanOrEqual } from 'typeorm';
import { ClockService } from '../../common/clock';
import { transactionWithEffects } from '../../common/utils';
import type { ComputerContext } from '../../common/types';
import { Agent } from '../agents/entities/agent.entity';
import { ChatService } from '../chat/chat.service';
import { ComputersService } from '../computers/computers.service';
import { Computer } from '../computers/entities/computer.entity';
import { EventsService } from '../events';
import { AgentGatewayService, type ProgressEvent } from '../gateway/agent-gateway.service';
import { Assignment, TERMINAL_STATUSES } from '../gateway/entities/assignment.entity';
import { AgentSession } from '../gateway/entities/agent-session.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { TaskEngineService } from '../tasks/task-engine.service';
import { WorkspaceLockService } from '../tasks/workspace-lock.service';
import { Member } from '../workspace/entities/member.entity';
import { AssignmentBriefService } from './assignment-brief.service';
import { ChatStreamService } from './chat-stream.service';
import {
  MAX_RESULT_TEXT,
  type ClaimDto,
  type HeartbeatDto,
  type ProgressDto,
  type ResultDto,
} from './dto/daemon.dto';
import { LEASE_MS } from '../../contacts';
import { ChatMessage } from '../chat/entities/chat-message.entity';

export interface GatewayAgent {
  id: string;
  name: string;
  persona: string;
  workdir: string;
  maxTurns: number;
  skills: string[];
}

export interface GatewayAssignment {
  id: string;
  attempt: number;
  kind: 'chat' | 'task';
  agent: GatewayAgent;
  session: { id: string; resume: boolean };
  prompt: string;
  context: string;
  requestedBy: { id: string; name: string; role: 'owner' | 'admin' | 'member' } | null;
  leaseMs: number;
  /** Chat runs only (additive; older daemons ignore them): the room and the thread root of the reply. */
  roomId?: string;
  parentId?: string | null;
}

/** How long a cancelled assignment is still reported on a heartbeat that lists no running ids. */
const RECENT_CANCEL_MS = 10 * 60_000;
const EMPTY_REPLY = '(không có nội dung)';
const MAX_TOOL_NAME = 100;
const MAX_TOOL_INPUT = 2000;
const MAX_TOOL_OUTPUT = 8000;
const TOOL_STATUSES = ['running', 'ok', 'error'];

const str = (value: unknown, max: number): string | null =>
  typeof value === 'string' ? value.slice(0, max) : null;

export const toGatewayAgent = (agent: Agent): GatewayAgent => ({
  id: agent.id,
  name: agent.name,
  persona: agent.persona,
  workdir: agent.workdir,
  maxTurns: agent.maxTurns,
  skills: agent.skills.filter((skill) => skill.enabled).map((skill) => skill.id),
});

/** Over-long result text is stored cut, with a note, instead of failing the whole report. */
export const clipResultText = (text: string): string =>
  text.length > MAX_RESULT_TEXT
    ? `${text.slice(0, MAX_RESULT_TEXT)}\n\n_(đã cắt bớt: kết quả dài ${text.length} ký tự)_`
    : text;

const isInvalidTransition = (error: unknown): boolean =>
  error instanceof ConflictException &&
  (error.getResponse() as { message?: string }).message === 'gateway.INVALID_TRANSITION';

/** Cancelled or expired server-side: the daemon must stop working on it. */
const isDropped = (row: Pick<Assignment, 'status'>): boolean =>
  row.status === 'cancelled' || row.status === 'expired';

interface ParsedProgress {
  text: string;
  /** Tool calls and turns, in the order the daemon reported them. */
  steps: Array<{ kind: 'tool'; call: ToolCall } | { kind: 'turns'; turns: number }>;
}

/** Keeps the events that are well formed and clamps their sizes; the rest is dropped. */
export const parseProgress = (events: Record<string, unknown>[]): ParsedProgress => {
  const parsed: ParsedProgress = { text: '', steps: [] };
  for (const event of events) {
    if (event.kind === 'text') {
      if (typeof event.delta === 'string') parsed.text += event.delta;
    } else if (event.kind === 'tool') {
      const call = event.call as Record<string, unknown> | undefined;
      const id = str(call?.id, 200);
      const name = str(call?.name, MAX_TOOL_NAME);
      const input = str(call?.input, MAX_TOOL_INPUT);
      const status = call?.status;
      if (!id || !name || input === null || typeof status !== 'string') continue;
      if (!TOOL_STATUSES.includes(status)) continue;
      parsed.steps.push({
        kind: 'tool',
        call: {
          id,
          name,
          input,
          output: str(call?.output, MAX_TOOL_OUTPUT),
          status: status as ToolCall['status'],
        },
      });
    } else if (event.kind === 'turns') {
      const turns = event.turns;
      if (typeof turns === 'number' && Number.isInteger(turns) && turns >= 0) {
        parsed.steps.push({ kind: 'turns', turns });
      }
    }
  }
  return parsed;
};

/**
 * What a real daemon does against the gateway over HTTP. Every call first resolves the
 * assignment as "this computer's own" (anything else is a 404), then drives the same gateway
 * transitions the in-process simulator uses, plus the chat/task side effects of a real run.
 */
@Injectable()
export class DaemonGatewayService {
  private readonly logger = new Logger(DaemonGatewayService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly gateway: AgentGatewayService,
    private readonly computers: ComputersService,
    private readonly chat: ChatService,
    private readonly engine: TaskEngineService,
    private readonly lock: WorkspaceLockService,
    private readonly events: EventsService,
    private readonly brief: AssignmentBriefService,
    private readonly streams: ChatStreamService,
  ) {}

  // ---------- computer ----------

  async heartbeat(
    computer: ComputerContext,
    dto: HeartbeatDto,
  ): Promise<{ agents: GatewayAgent[]; cancelled: string[] }> {
    if (dto.cliVersion) {
      await this.dataSource
        .getRepository(Computer)
        .update({ id: computer.id }, { cliVersion: dto.cliVersion });
    }
    await this.computers.heartbeat(computer.id);
    return {
      agents: await this.agentsOf(computer.id),
      cancelled: await this.cancelledFor(computer.id, dto.running),
    };
  }

  /**
   * Assignments of this computer the daemon must stop: of the ones it reports as running, or
   * (when it does not say) those cancelled/expired in the last few minutes.
   */
  private async cancelledFor(computerId: string, running?: string[]): Promise<string[]> {
    const dropped = ['cancelled', 'expired'] as const;
    if (running) {
      const ids = running.filter((id) => isUUID(id));
      if (!ids.length) return [];
      const rows = await this.dataSource.getRepository(Assignment).find({
        select: { id: true },
        where: { computerId, id: In(ids), status: In([...dropped]) },
      });
      return rows.map((row) => row.id);
    }
    const since = new Date(this.clock.now().getTime() - RECENT_CANCEL_MS);
    const rows = await this.dataSource.getRepository(Assignment).find({
      select: { id: true },
      where: { computerId, status: In([...dropped]), endedAt: MoreThanOrEqual(since) },
      order: { endedAt: 'DESC' },
      take: 100,
    });
    return rows.map((row) => row.id);
  }

  async agentsOf(computerId: string): Promise<GatewayAgent[]> {
    const agents = await this.dataSource.getRepository(Agent).find({
      where: { computerId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return agents.map(toGatewayAgent);
  }

  // ---------- claim ----------

  /** Hands over the oldest offered assignment of this computer (tasks only when no chat slot is free). */
  async claim(computer: ComputerContext, dto: ClaimDto): Promise<GatewayAssignment | null> {
    const kind = dto.maxChats !== undefined && dto.maxChats <= 0 ? 'task' : undefined;
    for (let tries = 0; tries < 5; tries++) {
      const row = await this.gateway.claim(computer.id, undefined, kind);
      if (!row) return null;
      const ready = await this.prepare(row);
      if (ready) return ready;
      // Its agent or source is gone: nothing to run, take the next one.
      await this.gateway.cancel(row.id).catch((error: unknown) => {
        if (!isInvalidTransition(error)) throw error;
      });
    }
    return null;
  }

  private async prepare(row: Assignment): Promise<GatewayAssignment | null> {
    const manager = this.dataSource.manager;
    const agent = await manager.findOneBy(Agent, { id: row.agentId });
    if (!agent) return null;
    const requester = row.requestedByMemberId
      ? await manager.findOneBy(Member, {
          id: row.requestedByMemberId,
          workspaceId: row.workspaceId,
          removedAt: IsNull(),
        })
      : null;
    const brief = await this.brief.build(row, agent, requester);
    if (!brief) return null;

    const key =
      row.sourceKind === 'chat' ? await this.chat.chatIdOfReply(row.id) : `task:${row.sourceId}`;
    if (!key) return null;
    await this.gateway.setSessionKey(row.id, key);
    const saved = await manager.findOneBy(AgentSession, { agentId: agent.id, key });
    if (row.sourceKind === 'chat') await this.streams.publishNow(row.id);
    const place = row.sourceKind === 'chat' ? await this.chat.placeOfReply(row.id) : null;

    return {
      id: row.id,
      attempt: row.attempt,
      kind: row.sourceKind,
      agent: toGatewayAgent(agent),
      session: saved ? { id: saved.sessionId, resume: true } : { id: randomUUID(), resume: false },
      prompt: brief.prompt,
      context: brief.context,
      requestedBy: requester
        ? { id: requester.id, name: requester.name, role: requester.role }
        : null,
      leaseMs: LEASE_MS,
      ...(place ? { roomId: place.roomId, parentId: place.parentId } : {}),
    };
  }

  // ---------- assignment lifecycle ----------

  async accept(computer: ComputerContext, id: string, attempt: number): Promise<{ ok: true }> {
    const owned = await this.gateway.findOwned(id, computer.id);
    const row = await this.gateway.accept(id, attempt);
    if (owned.sourceKind === 'chat') {
      await this.streams.publishNow(id);
    } else {
      this.events.publish(row.workspaceId, { type: 'tasks.changed' });
    }
    this.events.publish(row.workspaceId, { type: 'agents.changed' });
    return { ok: true };
  }

  async assignmentHeartbeat(
    computer: ComputerContext,
    id: string,
    attempt: number,
  ): Promise<{ ok: true; cancelled: boolean }> {
    const row = await this.gateway.findOwned(id, computer.id);
    if (isDropped(row)) return { ok: true, cancelled: true };
    try {
      await this.gateway.heartbeat(id, attempt);
    } catch (error) {
      if (await this.droppedMeanwhile(error, id, computer.id)) return { ok: true, cancelled: true };
      throw error;
    }
    return { ok: true, cancelled: false };
  }

  async progress(
    computer: ComputerContext,
    id: string,
    dto: ProgressDto,
  ): Promise<{ ok: true; cancelled: boolean }> {
    const row = await this.gateway.findOwned(id, computer.id);
    if (isDropped(row)) return { ok: true, cancelled: true };
    const parsed = parseProgress(dto.events);
    try {
      if (row.attempt !== dto.attempt || row.status !== 'running') {
        throw new ConflictException({ message: 'gateway.INVALID_TRANSITION' });
      }
      if (row.sourceKind === 'chat') {
        this.streams.append(row, parsed.text);
        if (parsed.steps.length) {
          await this.gateway.progress(id, dto.attempt, this.toProgressEvents(parsed));
          await this.streams.publishNow(id);
        }
      } else if (parsed.steps.length) {
        await this.engine.recordProgress(row.workspaceId, id, dto.attempt, parsed.steps);
      }
    } catch (error) {
      if (await this.droppedMeanwhile(error, id, computer.id)) return { ok: true, cancelled: true };
      throw error;
    }
    return { ok: true, cancelled: false };
  }

  private toProgressEvents(parsed: ParsedProgress): ProgressEvent[] {
    return parsed.steps.map((step) =>
      step.kind === 'tool'
        ? { kind: 'tool', payload: step.call }
        : { kind: 'step', payload: { turns: step.turns } },
    );
  }

  /** A conflict because the assignment was cancelled or expired a moment ago reads as "stop". */
  private async droppedMeanwhile(error: unknown, id: string, computerId: string): Promise<boolean> {
    if (!isInvalidTransition(error)) return false;
    const row = await this.gateway.findOwned(id, computerId);
    return isDropped(row);
  }

  // ---------- result ----------

  async result(computer: ComputerContext, id: string, input: ResultDto): Promise<{ ok: true }> {
    const dto = input.text === undefined ? input : { ...input, text: clipResultText(input.text) };
    const row = await this.gateway.findOwned(id, computer.id);
    // Cancelled or expired meanwhile (a stop): like progress, the late result is dropped.
    if (isDropped(row)) return this.dropResult(row);
    try {
      if (row.sourceKind === 'chat') await this.finishChat(row, dto);
      else await this.finishTask(row, dto);
    } catch (error) {
      if (await this.droppedMeanwhile(error, id, computer.id)) return this.dropResult(row);
      throw error;
    }
    return { ok: true };
  }

  private dropResult(row: Assignment): { ok: true } {
    this.streams.discard(row.id);
    return { ok: true };
  }

  private async finishChat(row: Assignment, dto: ResultDto): Promise<void> {
    const context = await this.chat.replyContext(row.id);
    const streamed = this.streams.textOf(row.id);
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      const tx = { manager, effects };
      const before = await this.lockRow(manager, row.id);
      const repeated = TERMINAL_STATUSES.includes(before.status);
      // A repeat of the same report is a no-op; a different one conflicts (inside `result`).
      const saved = await this.gateway.result(row.id, dto.attempt, this.resultInput(dto), tx);
      if (repeated) return;
      if (dto.status === 'completed') await this.saveSession(manager, saved, dto);
      if (!context) return;
      const ok = dto.status === 'completed';
      const written = dto.text?.trim() ? dto.text : clipResultText(streamed);
      // A completed reply is never an empty bubble.
      const text = ok && !written.trim() ? EMPTY_REPLY : written;
      // Never write into a message that was deleted while the agent was answering.
      await manager.update(
        ChatMessage,
        { id: context.message.id, deletedAt: IsNull() },
        { markdown: text, status: ok ? 'complete' : 'failed' },
      );
      if (ok) await this.chat.recordAgentMentions(manager, context.message.id, text, context.chat);
      const message = await this.chat.loadMessage(context.message.id, manager);
      effects.push(() => this.chat.publishMessage(row.workspaceId, message, context.memberIds));
      await this.chat.recordRun(
        manager,
        effects,
        context,
        saved.activation ?? '',
        ok,
        this.durationSec(saved),
      );
    });
    this.streams.discard(row.id);
  }

  private async finishTask(row: Assignment, dto: ResultDto): Promise<void> {
    await this.lock.run(row.workspaceId, async (manager, effects) => {
      const tx = { manager, effects };
      const before = await this.lockRow(manager, row.id);
      const repeated = TERMINAL_STATUSES.includes(before.status);
      const saved = await this.gateway.result(row.id, dto.attempt, this.resultInput(dto), tx);
      if (repeated) return;
      if (dto.status === 'completed') await this.saveSession(manager, saved, dto);
      if (dto.status === 'completed' && dto.text?.trim()) {
        // Only when nothing set it yet; the engine fills a default for the rest.
        await manager.update(
          TaskEntity,
          { workspaceId: row.workspaceId, id: row.sourceId, output: IsNull() },
          { output: dto.text },
        );
      }
    });
  }

  private resultInput(dto: ResultDto) {
    return {
      status: dto.status,
      error: dto.status === 'failed' ? dto.error?.trim() || 'agent failed' : null,
      numTurns: dto.numTurns ?? null,
      costUsd: dto.costUsd ?? null,
    };
  }

  private async lockRow(manager: EntityManager, id: string): Promise<Assignment> {
    return manager.findOneOrFail(Assignment, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /** Remembers the Claude session of the conversation so its next run resumes it. */
  private async saveSession(
    manager: EntityManager,
    assignment: Assignment,
    dto: ResultDto,
  ): Promise<void> {
    if (!dto.sessionId || !isUUID(dto.sessionId)) return;
    const key =
      assignment.sessionKey ??
      (assignment.sourceKind === 'task' ? `task:${assignment.sourceId}` : null);
    if (!key) return;
    await manager.query(
      `INSERT INTO agent_sessions (agent_id, key, session_id) VALUES ($1, $2, $3)
       ON CONFLICT (agent_id, key) DO UPDATE SET session_id = EXCLUDED.session_id`,
      [assignment.agentId, key, dto.sessionId],
    );
  }

  private durationSec(row: Assignment): number {
    const started = row.startedAt ?? row.createdAt;
    const ended = row.endedAt ?? this.clock.now();
    return Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1000));
  }
}
