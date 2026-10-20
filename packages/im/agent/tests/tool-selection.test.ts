import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@zhin.js/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zhin.js/core')>();
  return {
    ...actual,
    resolveSubjectRoles: vi.fn((_plugin: unknown, message: { _roles?: string[] }) => ({
      scope: 'group',
      roles: message?._roles ?? ['user'],
    })),
  };
});

import {
  canAccessTool,
  normalizeTool,
} from '../src/resource-hub/tool-selection.js';
import { planToolRun } from '../src/tool/runtime.js';
import { PermissionHost, createSceneRolePlatformChecker } from '@zhin.js/permission';
import { mockCommMessage } from './helpers/mock-comm-message.js';
import type { Tool } from '../src/resource-hub/types.js';

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'read_file',
    description: 'read file from disk',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'file path' },
      },
      required: ['path'],
    },
    execute: async args => args,
    ...overrides,
  };
}

describe('tool-selection permissions', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = new PermissionHost();
    host.registerPlatform('qq', createSceneRolePlatformChecker());
  });

  it('checks platform, scope and platform permit in one place', async () => {
    const tool = makeTool({
      platforms: ['qq'],
      scopes: ['group'],
      permissions: ['platform(qq,scene_admin)'],
    });
    const msg = {
      ...mockCommMessage({ adapter: 'qq', endpoint: 'b1', senderId: 'u1', scope: 'group', sceneId: 'g1' }),
      metadata: { senderRole: 'admin' },
    } as any;

    expect(await canAccessTool(tool, msg, host)).toBe(true);
    expect(await canAccessTool(tool, {
      ...msg,
      conversation: { ...msg.conversation, kind: 'private', id: 'u1' },
    }, host)).toBe(false);
    expect(await canAccessTool(tool, mockCommMessage({ adapter: 'qq', scope: 'group', senderId: undefined }), host)).toBe(false);
  });
});

describe('normalizeTool', () => {
  it('preserves agent metadata and permissions', () => {
    const agentTool = normalizeTool(makeTool({
      tags: ['files'],
      keywords: ['read'],
      permissions: ['role(trusted)'],
      preExecutable: true,
      kind: 'builtin',
    }));

    expect(agentTool.tags).toEqual(['files']);
    expect(agentTool.keywords).toEqual(['read']);
    expect(agentTool.permissions).toEqual(['role(trusted)']);
    expect(agentTool.preExecutable).toBe(true);
    expect(agentTool.kind).toBe('builtin');
  });

  it('injects contextKey parameters and hides them from the model schema', async () => {
    const tool = makeTool({
      parameters: {
        type: 'object',
        properties: {
          sceneId: { type: 'string', contextKey: 'sceneId' },
          count: { type: 'number', contextKey: 'count' },
          query: { type: 'string' },
        },
        required: ['sceneId', 'count', 'query'],
      },
      execute: async args => args,
    });
    const agentTool = normalizeTool(tool, {
      ...mockCommMessage({ sceneId: 'room-1' }),
      extra: { count: '2' },
    } as import('@zhin.js/core').AgentTurnMessage);

    expect(agentTool.parameters.properties).toEqual({ query: { type: 'string' } });
    expect(agentTool.parameters.required).toEqual(['query']);
    await expect(agentTool.execute({ query: 'hello' })).resolves.toEqual({
      query: 'hello',
      sceneId: 'room-1',
      count: 2,
    });
  });

  it('passes context to tools even when no contextKey parameters are declared', async () => {
    const tool = makeTool({
      execute: async (_args, commMessage) => commMessage?.sender?.id,
    });
    const agentTool = normalizeTool(tool, mockCommMessage({ senderId: 'u1' }));

    await expect(agentTool.execute({ path: 'a.txt' })).resolves.toBe('u1');
  });

  it('preserves Tool.source on AgentTool (reserved-name merge / builtin detection)', () => {
    const tool = makeTool({ source: 'builtin:agent' });
    const agentTool = normalizeTool(tool);
    expect(agentTool.source).toBe('builtin:agent');
  });
});

describe('pre-exec plans', () => {
  it('plans pre-executable fast path in the same tool runtime seam', async () => {
    const preTool = normalizeTool(makeTool({
      name: 'context_fetch',
      description: 'fetch context',
      preExecutable: true,
      execute: async () => 'fresh context',
    }));
    const plan = await planToolRun([preTool], 100);

    expect(plan.mode).toBe('pre-exec-fast-path');
    expect(plan.preExecTools.map(tool => tool.name)).toEqual(['context_fetch']);
    expect(plan.preExecution.data).toContain('fresh context');
  });

  it('keeps mixed pre-executable and normal tools on the agent path', async () => {
    const preTool = normalizeTool(makeTool({
      name: 'context_fetch',
      description: 'fetch context',
      preExecutable: true,
      execute: async () => 'fresh context',
    }));
    const normalTool = normalizeTool(makeTool({ name: 'read_file', description: 'read files' }));
    const plan = await planToolRun([preTool, normalTool], 100);

    expect(plan.mode).toBe('agent');
    expect(plan.hasNonPreExecTools).toBe(true);
  });
});
