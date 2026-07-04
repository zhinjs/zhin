/**
 * spawn_task 内置工具单测（issue #396）
 */
import { describe, it, expect, vi } from 'vitest';
import type { Message } from '@zhin.js/core';
import {
  createSpawnTaskTool,
  originFromMessage,
  SpawnTaskBuiltinTool,
} from '../../src/builtin/spawn-task-tool.js';
import type { SubagentManager } from '../../src/subagent.js';

function mockMessage(overrides: Partial<Message<any>> = {}): Message<any> {
  return {
    $adapter: 'qq',
    $endpoint: 'b1',
    $sender: { id: 'u1' },
    $channel: { type: 'group', id: 's1' },
    ...overrides,
  } as Message<any>;
}

describe('SpawnTaskBuiltinTool / createSpawnTaskTool', () => {
  it('originFromMessage wraps the comm message', () => {
    const full = mockMessage();
    expect(originFromMessage(full)).toEqual({ message: full });

    const minimal = {} as Message<any>;
    expect(originFromMessage(minimal)).toEqual({ message: minimal });
  });

  it('createSpawnTaskTool calls manager.spawn with origin from session context', async () => {
    const spawn = vi.fn().mockResolvedValue('子任务已启动');
    const manager = { spawn } as unknown as SubagentManager;

    const commMessage = mockMessage();

    const tool = createSpawnTaskTool(commMessage, manager);
    expect(tool.name).toBe('spawn_task');
    expect(tool.source).toBe('builtin:context');

    const out = await tool.execute({ task: '整理文档', label: 'doc' });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      task: '整理文档',
      label: 'doc',
      origin: { message: commMessage },
      agent: undefined,
      notifyContext: commMessage,
    }));
    expect(out).toBe('子任务已启动');
  });

  it('wait: true calls spawnSync and returns completed result', async () => {
    const spawnSync = vi.fn().mockResolvedValue('架构 Artifact 已创建');
    const spawn = vi.fn();
    const manager = { spawn, spawnSync } as unknown as SubagentManager;
    const commMessage = mockMessage({ $adapter: 'sandbox' });
    const tool = createSpawnTaskTool(commMessage, manager);
    const out = await tool.execute({
      task: '设计 wi-1',
      agent: 'architect',
      wait: true,
      label: '架构',
    });
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(String(out)).toContain('架构 Artifact 已创建');
    expect(String(out)).toContain('已完成');
  });

  it('run rejects empty task without calling spawn', async () => {
    const spawn = vi.fn();
    const manager = { spawn } as unknown as SubagentManager;
    const inst = new SpawnTaskBuiltinTool({} as Message<any>, manager);
    const out = await inst.run({ task: '' });
    expect(out).toBe('请提供任务描述');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('run rejects unauthorized agent via permission.task', async () => {
    const spawn = vi.fn();
    const manager = { spawn } as unknown as SubagentManager;
    const commMessage = mockMessage();
    const tool = createSpawnTaskTool(commMessage, manager, {
      allowedAgents: ['pm'],
      permissionTaskRules: { '*': 'deny', pm: 'allow' },
    });
    const out = await tool.execute({ task: '设计', agent: 'architect' });
    expect(String(out)).toContain('not allowed');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('description lists allowed agents when provided', () => {
    const tool = createSpawnTaskTool(mockMessage(), { spawn: vi.fn() } as unknown as SubagentManager, {
      allowedAgents: ['pm', 'dev'],
    });
    expect(tool.description).toContain('pm, dev');
    expect(tool.description).toContain('parallel');
  });
});
