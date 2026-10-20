import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { ApiError, type GatewayClient } from './api.js';
import type { GatewayAssignment } from './types.js';

export const WORKSPACE_SERVER = 'workspace';
export const WORKSPACE_TOOL_PREFIX = `mcp__${WORKSPACE_SERVER}__`;

/** `read` = anyone, `member` = needs a requester, `admin` = requester is owner|admin. */
export type ToolAccess = 'read' | 'member' | 'admin';

const subtask = z.object({ title: z.string(), done: z.boolean().optional() });

export interface WorkspaceToolSpec {
  name: string;
  access: ToolAccess;
  description: string;
  shape: z.ZodRawShape;
}

export const WORKSPACE_TOOLS: WorkspaceToolSpec[] = [
  {
    name: 'list_agents',
    access: 'read',
    description: 'List the agents of this workspace, with their job title and department.',
    shape: {},
  },
  {
    name: 'list_tasks',
    access: 'read',
    description: 'List tasks, optionally filtered by status or assignee.',
    shape: { status: z.string().optional(), assigneeId: z.string().optional() },
  },
  {
    name: 'get_task',
    access: 'read',
    description: 'Get one task with its subtasks and activity.',
    shape: { id: z.string() },
  },
  {
    name: 'list_members',
    access: 'read',
    description: 'List the human members of this workspace, with their job title and department.',
    shape: {},
  },
  {
    name: 'list_skills',
    access: 'member',
    description:
      'List the skills of the workspace skill library (read-only): slug, name and description. Use the slugs for the skills of create_agent / update_agent.',
    shape: {},
  },
  {
    name: 'create_task',
    access: 'member',
    description: 'Create a task. assigneeId may be an agent or a member id.',
    shape: {
      title: z.string(),
      description: z.string().optional(),
      assigneeId: z.string().optional(),
      priority: z.string().optional(),
      status: z.string().optional(),
      requiresReview: z.boolean().optional(),
    },
  },
  {
    name: 'update_task',
    access: 'member',
    description: 'Update a task: assignee, priority, review requirement or subtasks.',
    shape: {
      id: z.string(),
      assigneeId: z.string().nullable().optional(),
      priority: z.string().optional(),
      requiresReview: z.boolean().optional(),
      subtasks: z.array(subtask).optional(),
    },
  },
  {
    name: 'move_task',
    access: 'member',
    description: 'Move a task to another status column.',
    shape: { id: z.string(), status: z.string() },
  },
  {
    name: 'comment_task',
    access: 'member',
    description: 'Add a markdown comment to a task.',
    shape: { id: z.string(), markdown: z.string() },
  },
  {
    name: 'post_message',
    access: 'member',
    description:
      'Post a markdown message as this agent. Defaults to the chat of the current conversation.',
    shape: { chatId: z.string().optional(), markdown: z.string() },
  },
  {
    name: 'create_agent',
    access: 'admin',
    description:
      'Create a new agent (owner/admin only). Defaults to this computer. skills are slugs of skills from the workspace skill library (see list_skills).',
    shape: {
      name: z.string(),
      persona: z.string().optional(),
      skills: z
        .array(z.string())
        .optional()
        .describe('Slugs of skills from the workspace skill library (see list_skills)'),
      workdir: z.string().optional(),
      maxTurns: z.number().int().optional(),
      computerId: z.string().optional(),
      departmentId: z.string().optional(),
      title: z.string().optional(),
    },
  },
  {
    name: 'update_agent',
    access: 'admin',
    description:
      'Update an agent persona, skills (slugs from the workspace skill library, see list_skills; the full set of enabled skills), name, workdir, maxTurns, department or job title (owner/admin only). departmentId and title may be null to clear them.',
    shape: {
      id: z.string(),
      persona: z.string().optional(),
      skills: z
        .array(z.string())
        .optional()
        .describe('Slugs of skills from the workspace skill library (see list_skills)'),
      name: z.string().optional(),
      workdir: z.string().optional(),
      maxTurns: z.number().int().optional(),
      departmentId: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
    },
  },
];

/** Tools worth exposing for this requester; the server re-checks every call anyway. */
export function toolsFor(
  requestedBy: GatewayAssignment['requestedBy'],
  kind?: GatewayAssignment['kind'],
): WorkspaceToolSpec[] {
  return WORKSPACE_TOOLS.filter((t) => {
    if (t.access === 'read') return true;
    if (!requestedBy) return false;
    if (t.access === 'member') return true;
    // A task run never creates or edits agents (the server refuses it too).
    if (kind === 'task') return false;
    return requestedBy.role === 'owner' || requestedBy.role === 'admin';
  });
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Proxy one tool call to the gateway; errors become readable tool errors for the model. */
export async function callWorkspaceTool(
  client: GatewayClient,
  assignmentId: string,
  name: string,
  args: unknown,
): Promise<ToolResult> {
  try {
    const result = await client.tool(name, assignmentId, args);
    return { content: [{ type: 'text', text: JSON.stringify(result ?? null) }] };
  } catch (err) {
    const message =
      err instanceof ApiError
        ? err.status === 403
          ? `Not allowed: ${err.message}`
          : err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

export function createWorkspaceServer(client: GatewayClient, assignment: GatewayAssignment) {
  return createSdkMcpServer({
    name: WORKSPACE_SERVER,
    version: '1.0.0',
    tools: toolsFor(assignment.requestedBy, assignment.kind).map((spec) =>
      tool(spec.name, spec.description, spec.shape, (args) =>
        callWorkspaceTool(client, assignment.id, spec.name, args),
      ),
    ),
  });
}
