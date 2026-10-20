import { describe, it, expect } from 'vitest';
import {
  isAsyncPendingSpawnTaskResult,
  isSyncCompletedSpawnTaskResult,
  shouldSuppressReplyForSpawnDelegation,
} from '../../src/core/spawn-delegation.js';

describe('spawn-delegation', () => {
  it('detects sync wait=true completion', () => {
    expect(isSyncCompletedSpawnTaskResult(
      '子任务「成都天气查询」已完成（同步等待）。\n\n天气晴\n\n请根据以上结果继续后续步骤。',
    )).toBe(true);
    expect(isAsyncPendingSpawnTaskResult(
      '子任务「成都天气查询」已完成（同步等待）。\n\n天气晴',
    )).toBe(false);
  });

  it('detects async pending spawn', () => {
    expect(isAsyncPendingSpawnTaskResult(
      '子任务 [成都天气查询] 已启动 (id: 04b50996)，完成后会自动通知你。',
    )).toBe(true);
    expect(isSyncCompletedSpawnTaskResult(
      '子任务 [成都天气查询] 已启动 (id: 04b50996)，完成后会自动通知你。',
    )).toBe(false);
  });

  it('keeps main reply after sync spawn_task', () => {
    expect(shouldSuppressReplyForSpawnDelegation([
      {
        tool: 'spawn_task',
        result: '子任务 #04b50996「成都天气查询」已完成（同步等待）。\n\nok',
      },
    ])).toBe(false);
  });

  it('suppresses main reply for async-only spawn_task', () => {
    expect(shouldSuppressReplyForSpawnDelegation([
      {
        tool: 'spawn_task',
        result: '子任务 [成都天气查询] 已启动 (id: 04b50996)，完成后会自动通知你。',
      },
    ])).toBe(true);
  });

  it('keeps reply when sync and async spawns mix', () => {
    expect(shouldSuppressReplyForSpawnDelegation([
      {
        tool: 'spawn_task',
        result: '子任务 [A] 已启动 (id: a)，完成后会自动通知你。',
      },
      {
        tool: 'spawn_task',
        result: '子任务「B」已完成（同步等待）。\n\nok',
      },
    ])).toBe(false);
  });
});
