import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  MAX_TITLE as MAX_JOB_TITLE,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '@repo/shared';
import { DataSource, IsNull } from 'typeorm';
import { ClockService } from '../../common/clock';
import { ASSIGNMENT_ENDED_EVENT, type AssignmentEndedPayload } from '../events';
import type { AuthContext, ComputerContext } from '../../common/types';
import {
  MAX_NAME_LENGTH,
  MAX_PERSONA_LENGTH,
  MAX_TURNS_LIMIT,
  MAX_WORKDIR_LENGTH,
} from '../agents/dto/agent.dto';
import { AgentActivity } from '../agents/entities/agent-activity.entity';
import { Agent } from '../agents/entities/agent.entity';
import { Department } from '../departments/entities/department.entity';
import { AgentsService } from '../agents/agents.service';
import { ChatService } from '../chat/chat.service';
import { AgentGatewayService } from '../gateway/agent-gateway.service';
import { TASK_PRIORITIES, TASK_STATUSES } from '../tasks/dto/task.dto';
import { TaskEntity } from '../tasks/entities/task.entity';
import { MAX_TEXT_LENGTH, MAX_TITLE_LENGTH } from '../tasks/task-constants';
import type { Via } from '../tasks/task-command';
import { TaskEngineService } from '../tasks/task-engine.service';
import { TasksQueryService } from '../tasks/tasks-query.service';
import { Member } from '../workspace/entities/member.entity';

type Input = Record<string, unknown>;
type Access = 'read' | 'member' | 'admin';

interface ToolContext {
  workspaceId: string;
  agent: Agent;
  /** The member the run acts for; null = read tools only. */
  member: Member | null;
  assignmentId: string;
  computerId: string;
  sourceKind: 'chat' | 'task';
  sourceId: string;
  /** Set for member tools (member is non-null there). */
  via: Via | null;
}

interface ToolSpec {
  access: Access;
  run: (ctx: ToolContext, input: Input) => Promise<unknown>;
}

/** Write-tool calls one assignment may make (a runaway or prompt-injected run stops here). */
export const MAX_WRITE_CALLS = 20;
/** Where the daemon keeps agent workdirs (its default allowed root). */
const AGENT_WORKDIR_ROOT = '~/.agent/agents';

const badInput = (detail: string): BadRequestException =>
  new BadRequestException({ message: 'gateway.TOOL_INPUT', args: { detail } });

const reqString = (input: Input, key: string, max: number): string => {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) throw badInput(`"${key}" is required`);
  if (value.length > max) throw badInput(`"${key}" is longer than ${max} characters`);
  return value;
};
const optString = (input: Input, key: string, max: number): string | undefined => {
  if (input[key] === undefined || input[key] === null) return undefined;
  return reqString(input, key, max);
};
/** Like `optString`, but `null` stays `null` (it clears the field). */
const nullableString = (input: Input, key: string, max: number): string | null | undefined =>
  input[key] === null ? null : optString(input, key, max);
const optBool = (input: Input, key: string): boolean | undefined => {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw badInput(`"${key}" must be true or false`);
  return value;
};
const optInt = (input: Input, key: string, min: number, max: number): number | undefined => {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw badInput(`"${key}" must be an integer from ${min} to ${max}`);
  }
  return value;
};
const optEnum = <T extends string>(
  input: Input,
  key: string,
  allowed: readonly T[],
): T | undefined => {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw badInput(`"${key}" must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
};
const optStringList = (input: Input, key: string): string[] | undefined => {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string') || value.length > 200) {
    throw badInput(`"${key}" must be a list of strings`);
  }
  return value as string[];
};

/**
 * A workdir given by a tool is a plain relative name: the daemon only runs inside its workdir
 * roots, so it is stored under the default root. Absolute paths, `~` and `..` are refused.
 */
export const toolWorkdir = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  const name = raw.trim();
  if (/^([/\\~]|[A-Za-z]:)/.test(name) || name.includes('\\')) {
    throw badInput('"workdir" must be a relative folder name, not an absolute path');
  }
  const parts = name.split('/').filter((part) => part !== '' && part !== '.');
  if (!parts.length) throw badInput('"workdir" is empty');
  if (parts.includes('..')) throw badInput('"workdir" must not contain ".."');
  return `${AGENT_WORKDIR_ROOT}/${parts.join('/')}`;
};

const compactTask = (task: Task) => ({
  id: task.id,
  title: task.title,
  status: task.status,
  assigneeId: task.assigneeId,
  priority: task.priority,
  requiresReview: task.requiresReview,
  blockedReason: task.blockedReason,
  error: task.error,
  subtasks: task.subtasks,
  running: !!task.activeRun,
});

/** Workspace tools of a daemon run. Each call re-checks the run and the requester's role. */
@Injectable()
export class GatewayToolsService {
  private readonly tools: Record<string, ToolSpec>;
  /**
   * Write calls made so far per running assignment (dropped when it ends). Kept in memory on
   * purpose: a restart resets the count (a run could then make up to MAX_WRITE_CALLS more) and
   * with several API instances each one counts separately. Move it to the assignments table if
   * that ever matters.
   */
  private readonly writeCalls = new Map<string, number>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly gateway: AgentGatewayService,
    private readonly agents: AgentsService,
    private readonly query: TasksQueryService,
    private readonly engine: TaskEngineService,
    private readonly chat: ChatService,
  ) {
    this.tools = {
      list_agents: { access: 'read', run: (ctx) => this.listAgents(ctx) },
      list_tasks: { access: 'read', run: (ctx, input) => this.listTasks(ctx, input) },
      get_task: { access: 'read', run: (ctx, input) => this.getTask(ctx, input) },
      list_members: { access: 'read', run: (ctx) => this.listMembers(ctx) },
      create_task: { access: 'member', run: (ctx, input) => this.createTask(ctx, input) },
      update_task: { access: 'member', run: (ctx, input) => this.updateTask(ctx, input) },
      move_task: { access: 'member', run: (ctx, input) => this.moveTask(ctx, input) },
      comment_task: { access: 'member', run: (ctx, input) => this.commentTask(ctx, input) },
      post_message: { access: 'member', run: (ctx, input) => this.postMessage(ctx, input) },
      create_agent: { access: 'admin', run: (ctx, input) => this.createAgent(ctx, input) },
      update_agent: { access: 'admin', run: (ctx, input) => this.updateAgent(ctx, input) },
    };
  }

  @OnEvent(ASSIGNMENT_ENDED_EVENT)
  onAssignmentEnded(payload: AssignmentEndedPayload): void {
    this.writeCalls.delete(payload.assignmentId);
  }

  async execute(
    computer: ComputerContext,
    assignmentId: string,
    name: string,
    input: Input,
  ): Promise<{ result: unknown }> {
    const row = await this.gateway.findOwned(assignmentId ?? '', computer.id);
    if (row.status !== 'running') {
      throw new ConflictException({ message: 'gateway.NOT_RUNNING' });
    }
    const tool = Object.hasOwn(this.tools, name) ? this.tools[name] : undefined;
    if (!tool) throw new NotFoundException({ message: 'gateway.UNKNOWN_TOOL', args: { name } });

    const manager = this.dataSource.manager;
    const agent = await manager.findOneBy(Agent, { id: row.agentId });
    if (!agent) throw new ConflictException({ message: 'gateway.NOT_RUNNING' });
    // The role is read now, not taken from the claim: a demoted member loses write access at once.
    const member = row.requestedByMemberId
      ? await manager.findOneBy(Member, {
          id: row.requestedByMemberId,
          workspaceId: row.workspaceId,
          removedAt: IsNull(),
        })
      : null;
    // A task run acts on text that any member can edit (description, comments), so it never gets
    // admin tools, whoever started it. Chat runs keep the requester's real role.
    const isAdmin = !!member && (member.role === 'owner' || member.role === 'admin');
    const allowed =
      tool.access === 'read' ||
      (tool.access === 'member' && !!member) ||
      (tool.access === 'admin' && isAdmin && row.sourceKind !== 'task');
    if (!allowed) {
      throw new ForbiddenException({
        message:
          tool.access === 'admin' && isAdmin ? 'gateway.TASK_RUN_NO_ADMIN' : 'auth.FORBIDDEN',
      });
    }

    if (tool.access !== 'read') {
      const used = this.writeCalls.get(row.id) ?? 0;
      if (used >= MAX_WRITE_CALLS) {
        throw new ConflictException({
          message: 'gateway.TOOL_LIMIT',
          args: { max: MAX_WRITE_CALLS },
        });
      }
      this.writeCalls.set(row.id, used + 1);
    }

    const ctx: ToolContext = {
      workspaceId: row.workspaceId,
      agent,
      member,
      assignmentId: row.id,
      computerId: row.computerId,
      sourceKind: row.sourceKind,
      sourceId: row.sourceId,
      via: member ? { agentId: agent.id, memberName: member.name } : null,
    };
    try {
      const result = await tool.run(ctx, input && typeof input === 'object' ? input : {});
      return { result: result ?? null };
    } catch (error) {
      // The model reads the message: domain failures (not found, conflicts) become plain 400s.
      if (
        error instanceof HttpException &&
        error.getStatus() !== 400 &&
        error.getStatus() !== 403 &&
        error.getStatus() < 500
      ) {
        throw new BadRequestException(error.getResponse());
      }
      throw error;
    }
  }

  // ---------- read ----------

  private async departmentNames(workspaceId: string): Promise<Map<string, string>> {
    const rows = await this.dataSource.getRepository(Department).find({ where: { workspaceId } });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private async listAgents(ctx: ToolContext) {
    const agents = await this.agents.list(ctx.workspaceId);
    const departments = await this.departmentNames(ctx.workspaceId);
    return agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      title: agent.title,
      department: (agent.departmentId && departments.get(agent.departmentId)) || null,
      status: agent.status,
      computerId: agent.computerId,
      workdir: agent.workdir,
      skills: agent.skills.filter((skill) => skill.enabled).map((skill) => skill.id),
    }));
  }

  private async listTasks(ctx: ToolContext, input: Input) {
    const status = optEnum<TaskStatus>(input, 'status', TASK_STATUSES);
    const assigneeId = optString(input, 'assigneeId', 100);
    const tasks = await this.query.list(ctx.workspaceId);
    return tasks
      .filter(
        (task) =>
          (!status || task.status === status) && (!assigneeId || task.assigneeId === assigneeId),
      )
      .slice(0, 200)
      .map(compactTask);
  }

  private async getTask(ctx: ToolContext, input: Input) {
    const task = await this.query.get(ctx.workspaceId, reqString(input, 'id', 50));
    return {
      ...compactTask(task),
      description: task.description,
      output: task.output,
      labels: task.labels,
      runs: task.runs.length,
      activity: task.activity.slice(-20).map((a) => ({
        by: a.by,
        at: a.at,
        kind: a.kind,
        text: a.text,
      })),
    };
  }

  private async listMembers(ctx: ToolContext) {
    const members = await this.dataSource.getRepository(Member).find({
      where: { workspaceId: ctx.workspaceId, removedAt: IsNull() },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const departments = await this.departmentNames(ctx.workspaceId);
    return members.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      title: member.title,
      department: (member.departmentId && departments.get(member.departmentId)) || null,
    }));
  }

  // ---------- write: any member ----------

  private async createTask(ctx: ToolContext, input: Input) {
    const assigneeId = optString(input, 'assigneeId', 100);
    let status = optEnum<TaskStatus>(input, 'status', TASK_STATUSES);
    // A task run must not start further runs by itself: what it hands to an agent waits in
    // `backlog` until a person moves it.
    if (ctx.sourceKind === 'task' && assigneeId && (await this.isAgent(ctx, assigneeId))) {
      status = 'backlog';
    }
    const id = await this.engine.createTask(
      ctx.workspaceId,
      ctx.member!.id,
      {
        title: reqString(input, 'title', MAX_TITLE_LENGTH).trim(),
        description: optString(input, 'description', MAX_TEXT_LENGTH),
        assigneeId,
        priority: optEnum<TaskPriority>(input, 'priority', TASK_PRIORITIES),
        status,
        requiresReview: optBool(input, 'requiresReview'),
      },
      ctx.via!,
    );
    return compactTask(await this.query.get(ctx.workspaceId, id));
  }

  private async isAgent(ctx: ToolContext, id: string): Promise<boolean> {
    return this.dataSource.getRepository(Agent).existsBy({ id, workspaceId: ctx.workspaceId });
  }

  private async updateTask(ctx: ToolContext, input: Input) {
    const id = reqString(input, 'id', 50);
    const subtasks = input.subtasks;
    if (subtasks !== undefined && !Array.isArray(subtasks)) {
      throw badInput('"subtasks" must be a list of { title, done? }');
    }
    const assignee = input.assigneeId;
    if (assignee !== undefined && assignee !== null && typeof assignee !== 'string') {
      throw badInput('"assigneeId" must be a string or null');
    }
    if (ctx.sourceKind === 'task' && assignee && (await this.isAgent(ctx, assignee))) {
      throw new ForbiddenException({ message: 'gateway.TASK_RUN_NO_ASSIGN' });
    }
    if (ctx.sourceKind === 'task' && input.requiresReview !== undefined) {
      throw new ForbiddenException({ message: 'gateway.TASK_RUN_NO_REVIEW_CHANGE' });
    }
    await this.engine.updateTask(
      ctx.workspaceId,
      ctx.member!.id,
      id,
      {
        assigneeId: assignee,
        priority: optEnum<TaskPriority>(input, 'priority', TASK_PRIORITIES),
        requiresReview: optBool(input, 'requiresReview'),
        subtasks: (subtasks as Input[] | undefined)?.map((s) => ({
          title: reqString(s ?? {}, 'title', MAX_TITLE_LENGTH),
          done: optBool(s ?? {}, 'done') ?? false,
        })),
      },
      ctx.via!,
    );
    return compactTask(await this.query.get(ctx.workspaceId, id));
  }

  private async moveTask(ctx: ToolContext, input: Input) {
    const id = reqString(input, 'id', 50);
    const status = optEnum<TaskStatus>(input, 'status', TASK_STATUSES);
    if (!status) throw badInput('"status" is required');
    if (ctx.sourceKind === 'task' && (status === 'todo' || status === 'doing')) {
      throw new ForbiddenException({ message: 'gateway.TASK_RUN_NO_ASSIGN' });
    }
    if (ctx.sourceKind === 'task' && status === 'done') {
      throw new ForbiddenException({ message: 'gateway.TASK_RUN_NO_DONE' });
    }
    await this.engine.moveTask(ctx.workspaceId, ctx.member!.id, id, { status }, ctx.via!);
    return compactTask(await this.query.get(ctx.workspaceId, id));
  }

  private async commentTask(ctx: ToolContext, input: Input) {
    const id = reqString(input, 'id', 50);
    await this.engine.comment(
      ctx.workspaceId,
      ctx.member!.id,
      id,
      reqString(input, 'markdown', MAX_TEXT_LENGTH),
      ctx.via!,
    );
    return { ok: true, taskId: id };
  }

  private async postMessage(ctx: ToolContext, input: Input) {
    const markdown = reqString(input, 'markdown', MAX_TEXT_LENGTH);
    const roomId = optString(input, 'roomId', 100);
    const parentId = optString(input, 'parentId', 100);
    const explicit = optString(input, 'chatId', 100);
    const auth: AuthContext = {
      memberId: ctx.member!.id,
      workspaceId: ctx.workspaceId,
      role: ctx.member!.role,
    };
    // `roomId` (+ optional `parentId`, a message of that room) is the new address; `chatId`
    // (a DM room or a thread root id) is what installed daemons send; neither = the run's own chat.
    let target: string | { roomId: string; parentId?: string | null };
    if (roomId) {
      target = { roomId, parentId: parentId ?? null };
    } else if (parentId) {
      throw badInput('"parentId" needs a "roomId"');
    } else {
      const chatId = explicit ?? (await this.ownChatId(ctx));
      if (!chatId) throw badInput('"chatId" is required: this run has no chat of its own');
      target = chatId;
    }
    const message = await this.chat.postAgentMessage(auth, ctx.agent.id, target, markdown);
    return {
      id: message.id,
      chatId: message.chatId,
      roomId: message.roomId,
      parentId: message.parentId ?? null,
    };
  }

  /** The chat the run belongs to: a reply's own chat, or the DM a task was assigned in. */
  private async ownChatId(ctx: ToolContext): Promise<string | null> {
    if (ctx.sourceKind === 'chat') return this.chat.chatIdOfReply(ctx.assignmentId);
    const task = await this.dataSource.getRepository(TaskEntity).findOneBy({
      workspaceId: ctx.workspaceId,
      id: ctx.sourceId,
    });
    return task?.chatId ?? null;
  }

  // ---------- write: owner / admin ----------

  private async createAgent(ctx: ToolContext, input: Input) {
    const name = reqString(input, 'name', MAX_NAME_LENGTH).trim();
    const skills = optStringList(input, 'skills');
    const computerId = optString(input, 'computerId', 100);
    const created = await this.agents.create(
      ctx.workspaceId,
      {
        name,
        computerId: computerId ?? ctx.computerId,
        persona: optString(input, 'persona', MAX_PERSONA_LENGTH),
        skills: skills?.map((id) => ({ id, enabled: true })),
        workdir: toolWorkdir(optString(input, 'workdir', MAX_WORKDIR_LENGTH)),
        maxTurns: optInt(input, 'maxTurns', 1, MAX_TURNS_LIMIT),
        departmentId: optString(input, 'departmentId', 100),
        title: optString(input, 'title', MAX_JOB_TITLE)?.trim(),
      },
      { memberId: ctx.member?.id ?? null },
    );
    await this.recordAgentChange(ctx, `tạo agent **${created.name}**`);
    return this.agentSummary(created);
  }

  private async updateAgent(ctx: ToolContext, input: Input) {
    const id = reqString(input, 'id', 100);
    const wanted = optStringList(input, 'skills');
    let skills: { id: string; enabled: boolean }[] | undefined;
    if (wanted) {
      const catalog = this.agents.skillCatalog();
      const known = new Set(catalog.map((skill) => skill.id));
      const unknown = wanted.filter((skill) => !known.has(skill));
      if (unknown.length) throw badInput(`unknown skills: ${unknown.join(', ')}`);
      // The list is the full set of enabled skills.
      skills = catalog.map((skill) => ({ id: skill.id, enabled: wanted.includes(skill.id) }));
    }
    const title = nullableString(input, 'title', MAX_JOB_TITLE);
    const updated = await this.agents.update(
      ctx.workspaceId,
      id,
      {
        persona: optString(input, 'persona', MAX_PERSONA_LENGTH),
        skills,
        name: optString(input, 'name', MAX_NAME_LENGTH)?.trim(),
        workdir: toolWorkdir(optString(input, 'workdir', MAX_WORKDIR_LENGTH)),
        maxTurns: optInt(input, 'maxTurns', 1, MAX_TURNS_LIMIT),
        departmentId: nullableString(input, 'departmentId', 100),
        title: title === null ? null : title?.trim(),
      },
      { memberId: ctx.member?.id ?? null },
    );
    await this.recordAgentChange(ctx, `sửa agent **${updated.name}**`);
    return this.agentSummary(updated);
  }

  private agentSummary(agent: Awaited<ReturnType<AgentsService['get']>>) {
    return {
      id: agent.id,
      name: agent.name,
      computerId: agent.computerId,
      workdir: agent.workdir,
      maxTurns: agent.maxTurns,
      departmentId: agent.departmentId,
      title: agent.title,
      skills: agent.skills.filter((skill) => skill.enabled).map((skill) => skill.id),
    };
  }

  /** The calling agent's activity log notes who it acted for. */
  private async recordAgentChange(ctx: ToolContext, what: string): Promise<void> {
    await this.dataSource.getRepository(AgentActivity).insert({
      workspaceId: ctx.workspaceId,
      agentId: ctx.agent.id,
      location: 'workspace tool',
      request: `(thay ${ctx.member!.name}) ${what}`,
      status: 'completed',
      at: this.clock.now(),
    });
  }
}
