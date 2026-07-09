import { describe, expect, it, vi } from 'vitest';
import {
  captureScheduleJobCreator,
  parseScheduleJobCreator,
  senderFromScheduleCreator,
} from '../../src/assistant/job-creator.js';
import { createTaskExecutor } from '../../src/task-executor.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

describe('schedule job creator', () => {
  it('captureScheduleJobCreator reads sender id and roles from commMessage', () => {
    const message = mockCommMessage({
      senderId: '1659488338',
      sender_roles: ['master'],
    });
    expect(captureScheduleJobCreator(message)).toEqual({
      userId: '1659488338',
      roles: ['master'],
      name: undefined,
    });
  });

  it('parseScheduleJobCreator normalizes persisted payload', () => {
    expect(
      parseScheduleJobCreator({
        userId: 'u1',
        roles: ['trusted', 'bogus'],
        name: 'Bob',
      }),
    ).toEqual({
      userId: 'u1',
      roles: ['trusted'],
      name: 'Bob',
    });
  });

  it('senderFromScheduleCreator maps roles to harness sender flags', () => {
    expect(senderFromScheduleCreator({ userId: 'm1', roles: ['master'] })).toMatchObject({
      id: 'm1',
      isMaster: true,
      isTrusted: false,
    });
    expect(senderFromScheduleCreator({ userId: 't1', roles: ['trusted'] })).toMatchObject({
      id: 't1',
      isMaster: false,
      isTrusted: true,
    });
    expect(senderFromScheduleCreator({ userId: 'u1', roles: ['user'] })).toMatchObject({
      id: 'u1',
      isMaster: false,
      isTrusted: false,
    });
  });
});

describe('task executor schedule creator', () => {
  it('passes createdBy sender snapshot into agent.process commMessage', async () => {
    const process = vi.fn(async () => [{ type: 'text', content: 'ok' }]);
    const initScheduleTurnContext = vi.fn();
    const executor = createTaskExecutor({
      agent: { process, initScheduleTurnContext } as any,
      resolveAdapter: () => undefined,
    });

    await executor.executeTask({
      prompt: 'weather',
      notify: { channel: 'silent' },
      createdBy: { userId: '1659488338', roles: ['master'], name: 'Owner' },
    });

    expect(process).toHaveBeenCalledTimes(1);
    const commMessage = process.mock.calls[0][1];
    expect(commMessage.$sender).toMatchObject({
      id: '1659488338',
      name: 'Owner',
      isMaster: true,
      isTrusted: false,
    });
    expect(initScheduleTurnContext).toHaveBeenCalledWith(expect.objectContaining({
      createdBy: { userId: '1659488338', roles: ['master'], name: 'Owner' },
    }));
    expect(commMessage.extra?.scheduleCreatedBy).toBeUndefined();
  });

  it('preview mode replies to creator and captures execution plan', async () => {
    const reply = vi.fn(async () => 'msg-id');
    const commMessage = mockCommMessage({ senderId: 'u1', sender_roles: ['master'] });
    (commMessage as { $reply?: typeof reply }).$reply = reply;

    const process = vi.fn(async () => [{ type: 'text', content: 'preview output' }]);
    const initScheduleTurnContext = vi.fn();
    const getLastTurnToolSnapshot = vi.fn(() => ({
      tools: ['web_search'],
      skills: ['weather'],
    }));

    const executor = createTaskExecutor({
      agent: { process, initScheduleTurnContext, getLastTurnToolSnapshot } as any,
      resolveAdapter: () => undefined,
    });

    const result = await executor.executeTask({
      prompt: 'daily weather',
      preview: true,
      previewCommMessage: commMessage,
      createdBy: { userId: 'u1', roles: ['master'] },
      notify: { channel: 'silent' },
    });

    expect(result.success).toBe(true);
    expect(result.responseText).toBe('preview output');
    expect(result.executionPlan).toMatchObject({
      prompt: 'daily weather',
      tools: ['web_search'],
      skills: ['weather'],
      previewSample: 'preview output',
      confirmed: false,
    });
    expect(reply).toHaveBeenCalledWith('preview output');
    expect(initScheduleTurnContext).toHaveBeenCalledWith(expect.objectContaining({
      preview: true,
      createdBy: { userId: 'u1', roles: ['master'] },
    }));
    expect(commMessage.extra?.schedulePreview).toBeUndefined();
  });
});
