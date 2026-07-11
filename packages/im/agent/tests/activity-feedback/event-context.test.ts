import { describe, it, expect } from 'vitest';
import {
  toActivityFeedbackEventContext,
  resolveActivitySceneType,
} from '../../src/activity-feedback/event-context.js';
import type { AIEventPayload } from '../../src/ai-event-subscriber.js';

describe('activity-feedback event-context', () => {
  it('应从 scope 解析 sceneType', () => {
    expect(resolveActivitySceneType({ sessionId: 's', scope: 'group' } as AIEventPayload)).toBe('group');
    expect(resolveActivitySceneType({ sessionId: 'group:1:u', sceneId: 'group:1' } as AIEventPayload)).toBe('group');
  });

  it('cron 私聊任务应回退 sceneId 为 userId', () => {
    const ctx = toActivityFeedbackEventContext({
      platform: 'icqq',
      endpointId: '75318',
      sessionId: 'icqq:75318:private:123',
      sceneId: '123',
      userId: 'system',
      scope: 'private',
    } as AIEventPayload);
    expect(ctx?.userId).toBe('123');
    expect(ctx?.groupId).toBe('123');
  });

  it('Slack 私聊应保留 DM channel 为 groupId 供出站 targeting', () => {
    const ctx = toActivityFeedbackEventContext({
      platform: 'slack',
      endpointId: 'zhin',
      sessionId: 'slack:zhin:private:U0AR2NQHRFV#1783730885856-1',
      sceneId: 'D0BGBM1S1J9',
      userId: 'U0AR2NQHRFV',
      scope: 'private',
      messageId: 'D0BGBM1S1J9:1783730885856.000000',
    } as AIEventPayload);
    expect(ctx?.userId).toBe('U0AR2NQHRFV');
    expect(ctx?.groupId).toBe('D0BGBM1S1J9');
    expect(ctx?.options.groupId).toBe('D0BGBM1S1J9');
  });
});
