import { describe, it, expect, vi } from 'vitest';
import {
  createNotificationRouter,
  mergeImNotify,
  notifyToSendOptions,
  resolveEffectiveNotify,
} from '../../src/assistant/notification-router.js';

describe('NotificationRouter', () => {
  it('notifyToSendOptions 构建 IM 发送选项', () => {
    expect(
      notifyToSendOptions(
        { channel: 'im', platform: 'qq', endpointId: 'bot1', sceneId: 'group1', scope: 'group' },
        'hello',
      ),
    ).toEqual({
      context: 'qq',
      endpoint: 'bot1',
      id: 'group1',
      type: 'group',
      content: 'hello',
    });
  });

  it('resolveEffectiveNotify 优先 notify 并合并 defaults', () => {
    const notify = resolveEffectiveNotify(
      { channel: 'im', platform: 'icqq', endpointId: '1' },
      { channel: 'im', platform: 'qq', endpointId: '2', sceneId: 's2', scope: 'private' },
    );
    expect(notify).toEqual({
      channel: 'im',
      platform: 'icqq',
      endpointId: '1',
      sceneId: 's2',
      scope: 'private',
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
        platform: 'icqq',
        endpointId: '8596238',
        sceneId: '1659488338',
        scope: 'private',
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

  it('mergeImNotify 与完整 im notify 投递一致', async () => {
    const routing = {
      platform: 'icqq',
      endpointId: '8596238',
      sceneId: '1659488338',
      scope: 'private',
    };
    const notifyFromMerge = mergeImNotify({ channel: 'im', ...routing });
    const sendMessage = vi.fn(async () => 'ok');
    const router = createNotificationRouter({
      resolveAdapter: () => ({ sendMessage }),
    });
    await router.deliver({ notify: notifyFromMerge, content: 'ping' });
    await router.deliver({ notify: { channel: 'im', ...routing }, content: 'ping' });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0]).toEqual(sendMessage.mock.calls[1]);
  });
});
