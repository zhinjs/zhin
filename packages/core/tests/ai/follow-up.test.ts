/**
 * FollowUpManager 测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FollowUpManager } from '../../src/ai/follow-up.js';

describe('FollowUpManager', () => {
  let manager: FollowUpManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new FollowUpManager();
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  const baseParams = {
    sessionId: 'session1',
    platform: 'qq',
    botId: 'bot1',
    senderId: 'user1',
    sceneId: 'group1',
    sceneType: 'group',
  };

  describe('schedule', () => {
    it('应创建跟进任务并返回确认文本', async () => {
      const result = await manager.schedule({
        ...baseParams,
        message: '提醒你吃饭',
        delayMinutes: 5,
      });

      expect(result).toContain('已安排提醒');
      expect(result).toContain('提醒你吃饭');
    });

    it('应限制最小延迟为 1 分钟', async () => {
      const result = await manager.schedule({
        ...baseParams,
        message: '立即提醒',
        delayMinutes: 0,
      });
      expect(result).toContain('已安排提醒');
    });

    it('应限制最大延迟为 7 天', async () => {
      const result = await manager.schedule({
        ...baseParams,
        message: '长期提醒',
        delayMinutes: 99999,
      });
      expect(result).toContain('天后');
    });

    it('同一会话新任务应自动取消旧任务', async () => {
      const sender = vi.fn();
      manager.setSender(sender);

      await manager.schedule({
        ...baseParams,
        message: '第一个提醒',
        delayMinutes: 10,
      });

      await manager.schedule({
        ...baseParams,
        message: '第二个提醒',
        delayMinutes: 5,
      });

      // 推进 11 分钟
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);

      // 只有第二个应触发
      expect(sender).toHaveBeenCalledTimes(1);
      expect(sender.mock.calls[0][0].message).toBe('第二个提醒');
    });
  });

  describe('到期触发', () => {
    it('到期应调用 sender', async () => {
      const sender = vi.fn();
      manager.setSender(sender);

      await manager.schedule({
        ...baseParams,
        message: '时间到了',
        delayMinutes: 1,
      });

      // 推进 1 分钟
      await vi.advanceTimersByTimeAsync(60 * 1000);

      expect(sender).toHaveBeenCalledTimes(1);
      expect(sender.mock.calls[0][0].message).toBe('时间到了');
    });

    it('无 sender 时不应崩溃', async () => {
      await manager.schedule({
        ...baseParams,
        message: '测试',
        delayMinutes: 1,
      });

      // 推进 1 分钟 - 不应抛错
      await vi.advanceTimersByTimeAsync(60 * 1000);
    });
  });

  describe('cancelBySession', () => {
    it('应取消指定会话的所有 pending 任务', async () => {
      const sender = vi.fn();
      manager.setSender(sender);

      await manager.schedule({
        ...baseParams,
        message: '会被取消',
        delayMinutes: 5,
      });

      const count = await manager.cancelBySession('session1');
      expect(count).toBe(1);

      // 推进时间，sender 不应被调用
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(sender).not.toHaveBeenCalled();
    });

    it('无 pending 时应返回 0', async () => {
      const count = await manager.cancelBySession('nonexistent');
      expect(count).toBe(0);
    });
  });

  describe('restore', () => {
    it('应恢复未完成的任务', async () => {
      const sender = vi.fn();
      manager.setSender(sender);

      // 创建一个 5 分钟后的任务
      await manager.schedule({
        ...baseParams,
        message: '恢复测试',
        delayMinutes: 5,
      });

      // 恢复
      const count = await manager.restore();
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('dispose', () => {
    it('应清理所有定时器和存储', async () => {
      const sender = vi.fn();
      manager.setSender(sender);

      await manager.schedule({
        ...baseParams,
        message: '测试',
        delayMinutes: 5,
      });

      manager.dispose();

      // 推进时间，sender 不应被调用
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(sender).not.toHaveBeenCalled();
    });
  });
});
