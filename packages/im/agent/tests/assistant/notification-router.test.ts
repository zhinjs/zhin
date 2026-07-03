import { describe, it, expect, vi } from 'vitest';
import {
  createNotificationRouter,
  imNotifyToSendOptions,
  parseJobNotify,
  resolveEffectiveNotify,
} from '../../src/assistant/notification-router.js';

const groupTarget = {
  channel: 'im' as const,
  target: {
    channel: 'im' as const,
    scene: {
      platform: 'qq',
      endpointId: 'bot1',
      sceneId: 'group1',
      kind: 'group' as const,
    },
  },
};

const privateTarget = {
  channel: 'im' as const,
  target: {
    channel: 'im' as const,
    scene: {
      platform: 'icqq',
      endpointId: '1',
      sceneId: 's2',
      kind: 'private' as const,
    },
  },
};

describe('NotificationRouter', () => {
  it('imNotifyToSendOptions 构建 IM 发送选项', () => {
    expect(imNotifyToSendOptions(groupTarget, 'hello')).toEqual({
      context: 'qq',
      endpoint: 'bot1',
      id: 'group1',
      type: 'group',
      content: 'hello',
    });
  });

  it('parseJobNotify 拒绝 flat legacy im notify', () => {
    expect(() =>
      parseJobNotify({ channel: 'im', platform: 'icqq', endpointId: '1' }),
    ).toThrow(/target/);
  });

  it('resolveEffectiveNotify 优先 notify 并合并 defaults target', () => {
    const notify = resolveEffectiveNotify(
      {
        channel: 'im',
        target: {
          channel: 'im',
          scene: {
            platform: 'icqq',
            endpointId: '1',
            sceneId: 's2',
            kind: 'private',
          },
        },
      },
      privateTarget,
    );
    expect(notify).toEqual({
      channel: 'im',
      target: {
        channel: 'im',
        scene: {
          platform: 'icqq',
          endpointId: '1',
          sceneId: 's2',
          kind: 'private',
        },
      },
    });
  });

  it('silent 通道不调用 sendMessage', async () => {
    const sendMessage = vi.fn();
    const router = createNotificationRouter({
      resolveAdapter: () => ({ sendMessage }),
    });
    const result = await router.deliver({
      notify: { channel: 'silent' },
      content: 'hidden',
      jobId: 'j1',
    });
    expect(result.delivered).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('im 通道经 Adapter.sendMessage 投递', async () => {
    const sendMessage = vi.fn(async () => 'msg-1');
    const router = createNotificationRouter({
      resolveAdapter: (platform) => (platform === 'icqq' ? { sendMessage } : undefined),
    });
    const result = await router.deliver({
      notify: {
        channel: 'im',
        target: {
          channel: 'im',
          scene: {
            platform: 'icqq',
            endpointId: '8596238',
            sceneId: '1659488338',
            kind: 'private',
          },
        },
      },
      content: '早报内容',
    });
    expect(result.delivered).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith({
      context: 'icqq',
      endpoint: '8596238',
      id: '1659488338',
      type: 'private',
      content: '早报内容',
    });
  });
});
