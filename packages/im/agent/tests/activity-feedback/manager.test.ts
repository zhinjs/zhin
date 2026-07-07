import { describe, it, expect, vi } from 'vitest';
import type { TypingIndicator, TypingIndicatorOptions } from '../../src/typing-indicator/index.js';
import { ActivityFeedbackManager } from '../../src/activity-feedback/manager.js';

function mockAdapter(onCreate?: (options: TypingIndicatorOptions) => void) {
  return {
    platform: 'test',
    supportedTypes: ['reaction', 'message', 'typing', 'none'] as const,
    createIndicator: (options: TypingIndicatorOptions) => {
      onCreate?.(options);
      const indicator: TypingIndicator = {
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        isActive: () => true,
      };
      return indicator;
    },
  };
}

describe('ActivityFeedbackManager', () => {
  it('isolates queued and active indicators by phase session id', async () => {
    const created: TypingIndicatorOptions[] = [];
    const manager = new ActivityFeedbackManager();
    manager.registerAdapter(mockAdapter((options) => created.push({ ...options })));

    const base = {
      platform: 'test',
      endpointId: 'ep1',
      sessionId: 'group:123:456',
      messageId: 'msg1',
      sceneType: 'group' as const,
    };

    await manager.start('queued', base, { type: 'reaction', emoji: '⏳' });
    await manager.start('active', base, { type: 'reaction', emoji: '60' });

    expect(created).toHaveLength(2);
    expect(created[0]!.sessionId).toBe('group:123:456::phase:queued');
    expect(created[1]!.sessionId).toBe('group:123:456::phase:active');

    expect(manager.getActiveIndicator('queued', base)).toBeDefined();
    expect(manager.getActiveIndicator('active', base)).toBeDefined();
  });

  it('stops only the requested phase', async () => {
    const stopFns: Array<ReturnType<typeof vi.fn>> = [];
    const manager = new ActivityFeedbackManager();
    manager.registerAdapter({
      platform: 'test',
      supportedTypes: ['message'],
      createIndicator: () => {
        const stop = vi.fn(async () => {});
        stopFns.push(stop);
        return {
          start: vi.fn(async () => {}),
          stop,
          isActive: () => true,
        };
      },
    });

    const base = {
      platform: 'test',
      endpointId: 'ep1',
      sessionId: 'group:1:2',
      sceneType: 'group' as const,
    };

    await manager.start('thinking', base, { type: 'message', message: '思考中' });
    await manager.stop('thinking', base);

    expect(stopFns).toHaveLength(1);
    expect(stopFns[0]).toHaveBeenCalledTimes(1);
  });
});
