import { describe, it, expect, vi } from 'vitest';
import {
  formatSubagentProcessingMessage,
  notifySubagentGoal,
  resolveSpawnExecutionKind,
  resolveSubagentDisplayLabel,
  SUBAGENT_GOAL_NOTIFY_EXTRA_KEY,
} from '../src/subagent-goal-notify.js';
import type { ToolContext } from '@zhin.js/core';

describe('subagent-goal-notify', () => {
  it('formatSubagentProcessingMessage 使用执行通道而非 AgentRole', () => {
    expect(
      formatSubagentProcessingMessage({
        taskId: '081024e4',
        kind: 'async',
        label: '画英短',
      }),
    ).toBe('任务【081024e4】:异步 => 画英短');
    expect(
      formatSubagentProcessingMessage({
        taskId: 'abc',
        kind: 'vision',
        label: '识图',
      }),
    ).toBe('任务【abc】:视觉 => 识图');
  });

  it('formatSubagentProcessingMessage 展示 agent 名', () => {
    expect(
      formatSubagentProcessingMessage({
        taskId: '23aba5a5',
        kind: 'draw',
        agent: 'draw',
        label: '画特朗普',
      }),
    ).toBe('任务【23aba5a5】:文生图·draw => 画特朗普');
  });

  it('resolveSpawnExecutionKind 区分 async/sync/vision/draw', () => {
    expect(resolveSpawnExecutionKind({ sync: false })).toBe('async');
    expect(resolveSpawnExecutionKind({ sync: true })).toBe('sync');
    expect(resolveSpawnExecutionKind({ sync: false, agent: 'vision' })).toBe('vision');
    expect(resolveSpawnExecutionKind({ sync: true, agent: 'vision' })).toBe('vision');
    expect(resolveSpawnExecutionKind({ sync: false, agent: 'draw' })).toBe('draw');
  });

  it('resolveSubagentDisplayLabel 无 label 时截断 task', () => {
    expect(resolveSubagentDisplayLabel(undefined, 'a'.repeat(40)).endsWith('...')).toBe(true);
    expect(resolveSubagentDisplayLabel('画猫', 'long task')).toBe('画猫');
  });

  it('notifySubagentGoal 调用 extra 回调', async () => {
    const notify = vi.fn();
    const ctx = {
      extra: { [SUBAGENT_GOAL_NOTIFY_EXTRA_KEY]: notify },
    } as ToolContext;
    await notifySubagentGoal(ctx, {
      taskId: 'abc12345',
      kind: 'deferred',
      label: '查 star',
    });
    expect(notify).toHaveBeenCalledWith({
      taskId: 'abc12345',
      kind: 'deferred',
      label: '查 star',
      agent: undefined,
    });
  });

  it('无回调时静默跳过', async () => {
    await expect(
      notifySubagentGoal(undefined, { taskId: 'x', kind: 'async', label: 'y' }),
    ).resolves.toBeUndefined();
  });
});
