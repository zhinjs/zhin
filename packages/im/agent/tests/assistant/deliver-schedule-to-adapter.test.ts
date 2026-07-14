import { describe, it, expect, vi } from 'vitest';
import { deliverScheduleToAdapter } from '../../src/assistant/deliver-schedule-to-adapter.js';
import type { JobNotify } from '../../src/assistant/types.js';

describe('deliverScheduleToAdapter', () => {
  it('uses proactiveOutbound for im channel', async () => {
    const send = vi.fn(async () => 'msg-1');
    const notify: JobNotify = {
      channel: 'im',
      target: {
        channel: 'im',
        scene: {
          platform: 'test',
          endpointId: 'default',
          sceneId: 'room-1',
          kind: 'group',
        },
      },
    };
    const result = await deliverScheduleToAdapter({
      notify,
      content: 'cron output',
      proactiveOutbound: { send, sendElements: async () => [] },
    });
    expect(result).toEqual({ delivered: true, channel: 'im' });
    expect(send).toHaveBeenCalledWith(
      { scene: notify.target.scene, source: 'scheduled' },
      'cron output',
    );
  });
});
