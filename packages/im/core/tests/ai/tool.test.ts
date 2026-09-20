/**
 * Tool Service 测试
 * 
 * 测试内容：
 * 1. 权限级别判断
 * 2. Tool 的 IM 上下文准入
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canAccessTool, roleSatisfies, type Tool } from '@zhin.js/core';
import { PermissionHost, createSceneRolePlatformChecker } from '@zhin.js/permission';

let host: PermissionHost;

beforeEach(() => {
  host = new PermissionHost();
  host.registerPlatform('qq', createSceneRolePlatformChecker());
});

afterEach(() => {
  host = undefined!;
});

function mockCommMessage(overrides: Record<string, any> = {}) {
  const scope = overrides.scope ?? 'private';
  const sender_roles = overrides.sender_roles as string[] | undefined;
  let isMaster = overrides.isMaster;
  let isTrusted = overrides.isTrusted;
  if (sender_roles?.includes('master')) isMaster = true;
  else if (sender_roles?.includes('trusted')) isTrusted = true;
  else if (sender_roles) {
    isMaster = false;
    isTrusted = false;
  }
  return {
    $adapter: overrides.adapter ?? 'qq',
    $endpoint: overrides.endpoint ?? 'bot1',
    $sender: {
      id: overrides.senderId ?? 'user1',
      ...(overrides.sender ?? {}),
      ...(overrides.role !== undefined ? { role: overrides.role } : {}),
      ...(isMaster !== undefined ? { isMaster } : {}),
      ...(isTrusted !== undefined ? { isTrusted } : {}),
    },
    $channel: { type: scope, id: overrides.sceneId ?? 'scene1' },
  };
}

function mockMessage(role: 'user' | 'scene_admin' | 'scene_owner' | 'master' = 'user') {
  const platformRole = role === 'scene_admin'
    ? 'admin'
    : role === 'scene_owner'
      ? 'owner'
      : undefined;
  const adapter = role === 'master' ? 'process' : 'qq';
  return {
    $adapter: adapter,
    $endpoint: 'b1',
    $sender: {
      id: 'u1',
      ...(platformRole ? { role: platformRole } : {}),
      ...(role === 'master' ? { isMaster: true } : { isMaster: false, isTrusted: false }),
    },
    $channel: { type: 'group', id: 'g1' },
  } as any;
}


describe('roleSatisfies', () => {
  it('master 可满足 trusted 要求', () => {
    expect(roleSatisfies(['master'], ['trusted'])).toBe(true);
  });

  it('user 无法满足 trusted 要求', () => {
    expect(roleSatisfies(['user'], ['trusted'])).toBe(false);
  });
});

describe('canAccessTool 函数', () => {
  const baseTool: Tool = {
    name: 'test',
    description: '',
    parameters: { type: 'object', properties: {} },
    execute: async () => '',
  };

  it('无限制的工具应该对所有人可用', async () => {
    expect(await canAccessTool(baseTool, undefined)).toBe(true);
  });

  it('应该正确检查平台限制', async () => {
    const tool: Tool = { ...baseTool, platforms: ['qq', 'telegram'] };
    
    expect(await canAccessTool(tool, mockCommMessage({ adapter: 'qq' }))).toBe(true);
    expect(await canAccessTool(tool, mockCommMessage({ adapter: 'telegram' }))).toBe(true);
    expect(await canAccessTool(tool, mockCommMessage({ adapter: 'discord' }))).toBe(false);
    expect(await canAccessTool(tool, undefined)).toBe(false);
  });

  it('应该正确检查场景限制', async () => {
    const tool: Tool = { ...baseTool, scopes: ['group'] };
    
    expect(await canAccessTool(tool, mockCommMessage({ scope: 'group' }))).toBe(true);
    expect(await canAccessTool(tool, mockCommMessage({ scope: 'private' }))).toBe(false);
  });

  it('应该正确检查 platform(...) permit', async () => {
    const tool: Tool = { ...baseTool, permissions: ['platform(qq,scene_admin)'] };
    const adminMsg = mockMessage('scene_admin');
    const ownerMsg = mockMessage('scene_owner');
    const masterMsg = mockMessage('master');

    expect(await canAccessTool(tool, adminMsg, host)).toBe(true);
    expect(await canAccessTool(tool, ownerMsg, host)).toBe(true);
    expect(await canAccessTool(tool, masterMsg, host)).toBe(false);
    expect(await canAccessTool(tool, undefined, host)).toBe(false);
  });

  it('应该组合检查所有条件', async () => {
    const tool: Tool = {
      ...baseTool,
      platforms: ['qq'],
      scopes: ['group'],
      permissions: ['platform(qq,scene_admin)'],
    };
    const okMsg = mockMessage('scene_admin');

    expect(await canAccessTool(tool, { ...okMsg, $adapter: 'qq', $channel: { type: 'group', id: 'g1' } }, host)).toBe(true);

    expect(await canAccessTool(tool, { ...okMsg, $adapter: 'telegram', $channel: { type: 'group', id: 'g1' } }, host)).toBe(false);

    expect(await canAccessTool(tool, { ...okMsg, $adapter: 'qq', $channel: { type: 'private', id: 'u1' } }, host)).toBe(false);

    expect(await canAccessTool(tool, mockCommMessage({ adapter: 'qq', scope: 'group' }), host)).toBe(false);
  });

  it('空平台数组应该允许所有平台', async () => {
    const tool: Tool = { ...baseTool, platforms: [] };
    
    expect(await canAccessTool(tool, mockCommMessage({ adapter: 'qq' }))).toBe(true);
    expect(await canAccessTool(tool, mockCommMessage({ adapter: 'telegram' }))).toBe(true);
  });

  it('空场景数组应该允许所有场景', async () => {
    const tool: Tool = { ...baseTool, scopes: [] };
    
    expect(await canAccessTool(tool, mockCommMessage({ scope: 'group' }))).toBe(true);
    expect(await canAccessTool(tool, mockCommMessage({ scope: 'private' }))).toBe(true);
  });
});
