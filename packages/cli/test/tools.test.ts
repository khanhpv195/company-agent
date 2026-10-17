import { describe, expect, it } from 'vitest';
import { GatewayClient } from '../src/api.js';
import {
  callWorkspaceTool,
  createWorkspaceServer,
  toolsFor,
  WORKSPACE_TOOLS,
} from '../src/tools.js';
import { assignment, envelope, errorResponse, fakeFetch } from './helpers.js';

describe('workspace tool proxy', () => {
  it('posts to /gateway/tools/:name with the assignment header and key', async () => {
    const { fetchImpl, calls } = fakeFetch({
      '/gateway/tools/list_tasks': () => envelope({ result: [{ id: 't1' }] }),
    });
    const client = new GatewayClient({ server: 'http://x', apiKey: 'agk_1', fetchImpl });
    const res = await callWorkspaceTool(client, 'as-9', 'list_tasks', { status: 'review' });
    expect(res).toEqual({ content: [{ type: 'text', text: '[{"id":"t1"}]' }] });
    expect(calls[0].headers['x-assignment-id']).toBe('as-9');
    expect(calls[0].headers.authorization).toBe('Bearer agk_1');
    expect(calls[0].body).toEqual({ status: 'review' });
  });

  it('turns 403/400 and network errors into readable tool errors', async () => {
    const { fetchImpl } = fakeFetch({
      '/gateway/tools/create_agent': () => errorResponse(403, 'Forbidden'),
      '/gateway/tools/get_task': () => errorResponse(400, 'Task not found'),
    });
    const client = new GatewayClient({ server: 'http://x', apiKey: 'k', fetchImpl });
    expect(await callWorkspaceTool(client, 'a', 'create_agent', {})).toMatchObject({
      isError: true,
      content: [{ text: 'Not allowed: Forbidden' }],
    });
    expect(await callWorkspaceTool(client, 'a', 'get_task', { id: 'x' })).toMatchObject({
      isError: true,
      content: [{ text: 'Task not found' }],
    });
    const down = new GatewayClient({
      server: 'http://x',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    const r = await callWorkspaceTool(down, 'a', 'list_agents', {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('unreachable');
  });

  it('exposes tools by requester role', () => {
    const names = (r: Parameters<typeof toolsFor>[0]) => toolsFor(r).map((t) => t.name);
    expect(names(null)).toEqual(['list_agents', 'list_tasks', 'get_task', 'list_members']);
    const member = names({ id: 'm', name: 'M', role: 'member' });
    expect(member).toContain('create_task');
    expect(member).not.toContain('create_agent');
    expect(names({ id: 'm', name: 'M', role: 'owner' })).toHaveLength(WORKSPACE_TOOLS.length);
    const admin = { id: 'm', name: 'M', role: 'admin' } as const;
    expect(toolsFor(admin, 'chat').map((t) => t.name)).toContain('create_agent');
    const inTask = toolsFor(admin, 'task').map((t) => t.name);
    expect(inTask).toContain('create_task');
    expect(inTask).not.toContain('create_agent');
    expect(inTask).not.toContain('update_agent');
  });

  it('builds an in-process MCP server named workspace', () => {
    const { fetchImpl } = fakeFetch({});
    const server = createWorkspaceServer(
      new GatewayClient({ server: 'http://x', apiKey: 'k', fetchImpl }),
      assignment(),
    );
    expect(server.type).toBe('sdk');
    expect(server.name).toBe('workspace');
  });
});
