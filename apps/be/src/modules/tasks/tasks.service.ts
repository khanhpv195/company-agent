import { Injectable } from '@nestjs/common';
import type { RunSpan, SchedulerState, Task } from '@repo/shared';
import type { AuthContext } from '../../common/types';
import {
  CommentDto,
  CreateTaskDto,
  MoveTaskDto,
  ReviseTaskDto,
  UpdateTaskDto,
} from './dto/task.dto';
import { TaskEngineService } from './task-engine.service';
import { TasksQueryService } from './tasks-query.service';

/** HTTP-facing commands: run through the engine, then re-read the updated task after commit. */
@Injectable()
export class TasksService {
  constructor(
    private readonly engine: TaskEngineService,
    private readonly query: TasksQueryService,
  ) {}

  list(auth: AuthContext): Promise<Task[]> {
    return this.query.list(auth.workspaceId);
  }

  async create(auth: AuthContext, dto: CreateTaskDto): Promise<Task> {
    const id = await this.engine.createTask(auth.workspaceId, auth.memberId, dto);
    return this.query.get(auth.workspaceId, id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateTaskDto): Promise<Task> {
    await this.engine.updateTask(auth.workspaceId, auth.memberId, id, dto);
    return this.query.get(auth.workspaceId, id);
  }

  async move(auth: AuthContext, id: string, dto: MoveTaskDto): Promise<Task> {
    await this.engine.moveTask(auth.workspaceId, auth.memberId, id, dto);
    return this.query.get(auth.workspaceId, id);
  }

  async approve(auth: AuthContext, id: string): Promise<Task> {
    await this.engine.approveTask(auth.workspaceId, auth.memberId, id);
    return this.query.get(auth.workspaceId, id);
  }

  async revise(auth: AuthContext, id: string, dto: ReviseTaskDto): Promise<Task> {
    await this.engine.reviseTask(auth.workspaceId, auth.memberId, id, dto.note);
    return this.query.get(auth.workspaceId, id);
  }

  async stop(auth: AuthContext, id: string): Promise<Task> {
    await this.engine.stopTask(auth.workspaceId, auth.memberId, id);
    return this.query.get(auth.workspaceId, id);
  }

  async retry(auth: AuthContext, id: string): Promise<Task> {
    await this.engine.retryTask(auth.workspaceId, auth.memberId, id);
    return this.query.get(auth.workspaceId, id);
  }

  async runNow(auth: AuthContext, id: string): Promise<Task> {
    await this.engine.runNow(auth.workspaceId, auth.memberId, id);
    return this.query.get(auth.workspaceId, id);
  }

  async comment(auth: AuthContext, id: string, dto: CommentDto): Promise<Task> {
    await this.engine.comment(auth.workspaceId, auth.memberId, id, dto.markdown);
    return this.query.get(auth.workspaceId, id);
  }

  spans(auth: AuthContext, since?: string): Promise<RunSpan[]> {
    return this.query.spans(auth.workspaceId, since);
  }

  scheduler(auth: AuthContext): Promise<SchedulerState> {
    return this.query.scheduler(auth.workspaceId);
  }

  async setScheduler(auth: AuthContext, paused: boolean): Promise<SchedulerState> {
    await this.engine.setPaused(auth.workspaceId, auth.memberId, paused);
    return this.query.scheduler(auth.workspaceId);
  }
}
