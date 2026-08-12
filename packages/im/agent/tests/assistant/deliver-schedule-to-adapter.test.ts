import { describe, it, expect, vi } from 'vitest';
import { deliverScheduleToAdapter } from '../../src/assistant/deliver-schedule-to-adapter.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';
import type { JobNotify } from '../../src/assistant/types.js';

describe('deliverScheduleToAdapter', () => {
  it('delegates to router with source', async () => {
    const sendMessage = vi.fn(async () => 'msg-1');
    const router = createNotificationRouter({
      resolveAdapter: () => ({ sendMessage }),
    });
    const notify: JobNotify = {
      channel: 'im',
      target: {
        channel: 'im',
        scene: {
          platform: 'test',
          endpointKey: 'default',
          sceneId: 'room-1',
          kind: 'group',
        },
      },
    };
    const result = await deliverScheduleToAdapter({
      notify,
      content: 'cron output',
      router,
      source: 'scheduled',
    });
    expect(result).toEqual({ delivered: true, channel: 'im' });
    expect(sendMessage).toHaveBeenCalledWith({
      context: 'test',
      endpoint: 'default',
      id: 'room-1',
      type: 'group',
      content: 'cron output',
    });
  });

  it('passes source through to sendIm callback', async () => {
    const sendIm = vi.fn(async () => {});
    const router = createNotificationRouter({
      resolveAdapter: () => undefined,
      sendIm,
    });
    const notify: JobNotify = {
      channel: 'im',
      target: {
        channel: 'im',
        scene: {
          platform: 'test',
          endpointKey: 'ep1',
          sceneId: 'room-1',
          kind: 'group',
        },
      },
    };
    const result = await deliverScheduleToAdapter({
      notify,
      content: 'hello',
      router,
      source: 'scheduled',
    });
    expect(result).toEqual({ delivered: true, channel: 'im' });
    expect(sendIm).toHaveBeenCalledWith(notify, 'hello', 'scheduled');
  });

  it('returns not delivered when no router provided', async () => {
    const result = await deliverScheduleToAdapter({
      notify: { channel: 'im', target: { channel: 'im', scene: { platform: 'x', endpointKey: 'e', sceneId: 's', kind: 'group' } } },
      content: 'text',
    });
    expect(result.delivered).toBe(false);
  });
});
