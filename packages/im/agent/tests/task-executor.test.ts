import { describe, expect, it, vi } from 'vitest';
import { createTaskExecutor } from '../src/task-executor.js';
import { notifyToSendOptions } from '../src/assistant/notification-router.js';

describe('task executor outbound seam', () => {
  it('converts im notify through the queue IM field contract shape', () => {
    expect(notifyToSendOptions({
      channel: 'im',
      platform: 'qq',
      botId: 'bot1',
      sceneId: 'group1',
      scope: 'group',
    }, 'hello')).toEqual({
      context: 'qq',
      bot: 'bot1',
      id: 'group1',
      type: 'group',
      content: 'hello',
    });
  });

  it('delivers agent output as normalized SendOptions', async () => {
    const sendMessage = vi.fn(async () => 'msg1');
    const executor = createTaskExecutor({
      agent: {
        process: vi.fn(async () => [{ type: 'text', content: 'hello' }]),
      } as any,
      resolveAdapter: () => ({ sendMessage }),
    });

    const result = await executor.executeTask({
      prompt: 'say hello',
      notify: {
        channel: 'im',
        platform: 'qq',
        botId: 'bot1',
        sceneId: 'group1',
        scope: 'group',
      },
    });

    expect(result.success).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith({
      context: 'qq',
      bot: 'bot1',
      id: 'group1',
      type: 'group',
      content: 'hello',
    });
  });
});
