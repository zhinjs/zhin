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
  });
});
