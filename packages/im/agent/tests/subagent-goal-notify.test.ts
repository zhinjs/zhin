import { describe, it, expect, vi } from 'vitest';

import {
  formatSubagentProcessingMessage,
  notifySubagentGoal,
  resolveSpawnExecutionKind,
  resolveSubagentDisplayLabel,
  SUBAGENT_GOAL_NOTIFY_EXTRA_KEY,
  shouldSuppressSubagentGoalNotifyToIm,
} from '../src/subagent-goal-notify.js';
import type { Message } from '@zhin.js/core';

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
        kind: 'sync',
        label: '识图',
      }),
    ).toBe('任务【abc】:同步 => 识图');
  });

  it('formatSubagentProcessingMessage 展示 agent 名', () => {
    expect(
      formatSubagentProcessingMessage({
        taskId: '23aba5a5',
        kind: 'async',
        agent: 'researcher',
        label: '查资料',
      }),
    ).toBe('任务【23aba5a5】:异步·researcher => 查资料');
  });

  it('resolveSpawnExecutionKind 区分 async/sync', () => {
    expect(resolveSpawnExecutionKind({ sync: false })).toBe('async');
    expect(resolveSpawnExecutionKind({ sync: true })).toBe('sync');
  });

  it('resolveSubagentDisplayLabel 无 label 时截断 task', () => {
    expect(resolveSubagentDisplayLabel(undefined, 'a'.repeat(40)).endsWith('...')).toBe(true);
    expect(resolveSubagentDisplayLabel('画猫', 'long task')).toBe('画猫');
  });

  it('notifySubagentGoal 调用 extra 回调', async () => {
    const notify = vi.fn();
    const ctx = {
      extra: { [SUBAGENT_GOAL_NOTIFY_EXTRA_KEY]: notify },
    } as Message<any>;
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

  it('shouldSuppressSubagentGoalNotifyToIm 多 Bot 同群协作时抑制 IM', () => {
    const cell = {
      members: [
        { endpointId: '8596238' },
        { endpointId: '210723495' },
      ],
    };
    const groupMsg = {
      $channel: { type: 'group', id: '373460458' },
    } as Message;
    const privateMsg = {
      $channel: { type: 'private', id: 'u1' },
    } as Message;
    expect(shouldSuppressSubagentGoalNotifyToIm(groupMsg, cell)).toBe(true);
    expect(shouldSuppressSubagentGoalNotifyToIm(privateMsg, cell)).toBe(false);
    expect(shouldSuppressSubagentGoalNotifyToIm(groupMsg, { members: [{ endpointId: 'a' }] })).toBe(false);
  });
});
