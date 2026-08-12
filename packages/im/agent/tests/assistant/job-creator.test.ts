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
  it('preview replies to the creator and captures the domain tool resolution', async () => {
    const reply = vi.fn(async () => 'msg-id');
    const commMessage = mockCommMessage({ senderId: 'u1', sender_roles: ['master'] });
    (commMessage as { $reply?: typeof reply }).$reply = reply;
    const executor = createTaskExecutor({
      agent: { getEventEmitter: () => ({ emit: vi.fn(), createPayload: vi.fn() }) } as any,
      domain: { execute: vi.fn(async (job) => ({
        success: true,
        output: 'preview output',
        durationMs: 1,
        toolsUsed: ['web_search'],
        tokenUsage: { input: 1, output: 1 },
        audit: {
          jobId: job.id, executionId: 'e1', timestamp: 1, createdBy: job.createdBy,
          prompt: job.action.prompt, toolsResolved: ['web_search', 'unused_tool'], toolsResolvedBy: 'affinity' as const,
          skillsResolved: ['weather'], missingTools: [], missingSkills: [],
          toolsUsed: ['web_search'], toolCallCount: 1, tokenUsage: { input: 1, output: 1 },
          durationMs: 1, securityDenials: [], success: true, outputLength: 14, outputStripped: [],
        },
      })) },
      resolveAdapter: () => undefined,
    });

    const result = await executor.preview('daily weather', commMessage, {
      createdBy: { userId: 'u1', roles: ['master'] },
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
  });
});
