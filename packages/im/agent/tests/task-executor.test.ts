import { describe, expect, it, vi } from 'vitest';
import { createTaskExecutor } from '../src/task-executor.js';
import { imNotifyToSendOptions } from '../src/assistant/notification-router.js';

describe('task executor outbound seam', () => {
  it('converts im notify through the queue IM field contract shape', () => {
    expect(imNotifyToSendOptions({
      channel: 'im',
      target: {
        channel: 'im',
        scene: {
          platform: 'qq',
          endpointId: 'bot1',
          sceneId: 'group1',
          kind: 'group',
        },
      },
    }, 'hello')).toEqual({
      context: 'qq',
      endpoint: 'bot1',
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
        initScheduleTurnContext: vi.fn(),
        getEventEmitter: () => ({
          emit: vi.fn(),
          createPayload: vi.fn(() => ({ sessionId: 's1', source: 'zhin-agent' })),
        }),
      } as any,
      resolveAdapter: () => ({ sendMessage }),
    });

    const result = await executor.executeTask({
      prompt: 'say hello',
      notify: {
        channel: 'im',
        target: {
          channel: 'im',
          scene: {
            platform: 'qq',
            endpointId: 'bot1',
            sceneId: 'group1',
            kind: 'group',
          },
        },
      },
    });

    expect(result.success).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith({
      context: 'qq',
      endpoint: 'bot1',
      id: 'group1',
      type: 'group',
      content: 'hello',
    });
  });

  it('waits for agent idle when scheduled turn returns empty (spawn_task delegation)', async () => {
    const waitForIdle = vi.fn(async () => {});
    const process = vi.fn(async () => [] as { type: string; content: string }[]);
    const executor = createTaskExecutor({
      agent: {
        process,
        initScheduleTurnContext: vi.fn(),
        waitForIdle,
        getEventEmitter: () => ({
          emit: vi.fn(),
          createPayload: vi.fn(() => ({ sessionId: 's1', source: 'zhin-agent' })),
        }),
      } as any,
      resolveAdapter: () => undefined,
    });

    const result = await executor.executeTask({
      prompt: 'daily weather',
      timeContext: true,
      scheduleJobId: 'assistant-profile-weatherReport',
      notify: { channel: 'silent' },
    });

    expect(result.success).toBe(true);
    expect(result.responseText).toBe('');
    expect(waitForIdle).toHaveBeenCalledTimes(1);
  });

  it('does not wait for idle when non-scheduled turn returns empty', async () => {
    const waitForIdle = vi.fn(async () => {});
    const executor = createTaskExecutor({
      agent: {
        process: vi.fn(async () => []),
        initScheduleTurnContext: vi.fn(),
        waitForIdle,
        getEventEmitter: () => ({
          emit: vi.fn(),
          createPayload: vi.fn(() => ({ sessionId: 's1', source: 'zhin-agent' })),
        }),
      } as any,
      resolveAdapter: () => undefined,
    });

    await executor.executeTask({
      prompt: 'hello',
      notify: { channel: 'silent' },
    });

    expect(waitForIdle).not.toHaveBeenCalled();
  });
});
