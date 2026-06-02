/**
 * spawn_task 内置工具单测（issue #396）
 */
import { describe, it, expect, vi } from 'vitest';
import type { ToolContext } from '@zhin.js/core';
import {
  createSpawnTaskTool,
  originFromToolContext,
  SpawnTaskBuiltinTool,
} from '../../src/builtin/spawn-task-tool.js';
import type { SubagentManager } from '../../src/subagent.js';

describe('SpawnTaskBuiltinTool / createSpawnTaskTool', () => {
  it('originFromToolContext maps context fields and default sceneType', () => {
    const full = {
      platform: 'qq',
      botId: 'b1',
      senderId: 'u1',
      sceneId: 's1',
      message: { $channel: { type: 'group' } },
    } as ToolContext;
    expect(originFromToolContext(full)).toEqual({
      platform: 'qq',
      botId: 'b1',
      senderId: 'u1',
      sceneId: 's1',
      sceneType: 'group',
    });

    const minimal = {} as ToolContext;
    expect(originFromToolContext(minimal)).toEqual({
      platform: '',
      botId: '',
      senderId: '',
      sceneId: '',
      sceneType: 'private',
    });
  });

  it('createSpawnTaskTool calls manager.spawn with origin from session context', async () => {
    const spawn = vi.fn().mockResolvedValue('子任务已启动');
    const manager = { spawn } as unknown as SubagentManager;

    const ctx = {
      platform: 'qq',
      botId: 'b1',
      senderId: 'u1',
      sceneId: 's1',
      message: { $channel: { type: 'group' } },
    } as ToolContext;

    const tool = createSpawnTaskTool(ctx, manager);
    expect(tool.name).toBe('spawn_task');
    expect(tool.source).toBe('builtin:context');

    const out = await tool.execute({ task: '整理文档', label: 'doc' });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith({
      task: '整理文档',
      label: 'doc',
      origin: {
        platform: 'qq',
        botId: 'b1',
        senderId: 'u1',
        sceneId: 's1',
        sceneType: 'group',
      },
    });
    expect(out).toBe('子任务已启动');
  });

  it('run rejects empty task without calling spawn', async () => {
    const spawn = vi.fn();
    const manager = { spawn } as unknown as SubagentManager;
    const inst = new SpawnTaskBuiltinTool({} as ToolContext, manager);
    const out = await inst.run({ task: '' });
    expect(out).toBe('请提供任务描述');
    expect(spawn).not.toHaveBeenCalled();
  });
});
