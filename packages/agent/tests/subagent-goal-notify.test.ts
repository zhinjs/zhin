import { describe, it, expect, vi } from 'vitest';
import {
  formatSubagentProcessingMessage,
  notifySubagentGoal,
  truncateSubagentGoal,
  SUBAGENT_GOAL_NOTIFY_EXTRA_KEY,
} from '../src/subagent-goal-notify.js';
import type { ToolContext } from '@zhin.js/core';

describe('subagent-goal-notify', () => {
  it('formatSubagentProcessingMessage 使用约定格式', () => {
    expect(formatSubagentProcessingMessage('给 QQ 点赞 20 次'))
      .toBe('🔧 正在执行：给 QQ 点赞 20 次');
  });

  it('保留 goal 中的标点与引号', () => {
    expect(formatSubagentProcessingMessage('say "hi"'))
      .toBe('🔧 正在执行：say "hi"');
  });

  it('truncateSubagentGoal 截断过长文本', () => {
    const long = 'a'.repeat(600);
    expect(truncateSubagentGoal(long).length).toBe(501);
  });

  it('notifySubagentGoal 调用 extra 回调', async () => {
    const notify = vi.fn();
    const ctx = {
      extra: { [SUBAGENT_GOAL_NOTIFY_EXTRA_KEY]: notify },
    } as ToolContext;
    await notifySubagentGoal(ctx, '  test goal  ');
    expect(notify).toHaveBeenCalledWith('test goal');
  });

  it('无回调时静默跳过', async () => {
    await expect(notifySubagentGoal(undefined, 'x')).resolves.toBeUndefined();
  });
});
