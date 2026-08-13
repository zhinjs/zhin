import { describe, expect, it, vi } from 'vitest';
import {
  scheduleJobCreatorFromPrincipal,
  parseScheduleJobCreator,
  senderFromScheduleCreator,
} from '../../src/assistant/job-creator.js';
import { createTaskExecutor } from '../../src/task-executor.js';

describe('schedule job creator', () => {
  it('captures the authenticated canonical principal without IM inference', () => {
    expect(scheduleJobCreatorFromPrincipal({
      subjectId: '1659488338',
      displayName: 'Owner',
      roles: ['master'],
    })).toEqual({
      userId: '1659488338',
      roles: ['master'],
      name: 'Owner',
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
  it('preview uses canonical creator context and captures the domain tool resolution', async () => {
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

    const result = await executor.preview('daily weather', {
      sessionKey: 'im:qq:bot:private:u1',
      origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'private', sceneId: 'u1' },
      principal: { subjectId: 'u1', roles: ['master'] },
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
  });
});
