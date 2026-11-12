import { describe, expect, it, vi } from 'vitest';
import {
  currentScheduleCreator,
  scheduleJobCreatorFromPrincipal,
  parseScheduleJobCreator,
} from '../../src/assistant/job-creator.js';
import { createTimerMailDueHandler } from '../../src/assistant/timer-due.js';
import { HostMailbox } from '../../src/collaboration/host-mailbox.js';
import type { ScheduleJob } from '../../src/assistant/types.js';
import type { TaskExecutionResult, TaskExecutor } from '../../src/task-executor.js';
import { createTaskExecutor } from '../../src/task-executor.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';

describe('schedule job creator', () => {
  it('captures the authenticated canonical principal without IM inference', () => {
    expect(scheduleJobCreatorFromPrincipal({
      subjectId: '1659488338',
      displayName: 'Owner',
      roles: ['owner'],
    })).toEqual({
      userId: '1659488338',
      roles: ['owner'],
      name: 'Owner',
    });
  });

  it('records where an IM creator spoke, and reads it back from persisted jobs', () => {
    const conversation = { endpoint: { adapter: 'root/qq', id: 'qq:bot' }, kind: 'group' as const, id: 'g1' };
    const creator = scheduleJobCreatorFromPrincipal({ subjectId: 'u1', roles: ['owner'] },
      { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'group', sceneId: 'g1', conversation });
    expect(creator.chat).toEqual({ conversation, endpointId: 'bot' });
    expect(parseScheduleJobCreator(JSON.parse(JSON.stringify(creator)))).toEqual(creator);
    expect(parseScheduleJobCreator({ userId: 'u1', roles: [], chat: { conversation: { id: 'x' }, endpointId: 'bot' } })?.chat).toBeUndefined();
  });

  it("a due run uses the creator's current role, not the captured one (ADR 0056 §5)", () => {
    const chat = { conversation: { endpoint: { adapter: 'root/qq', id: 'qq:bot' }, kind: 'group' as const, id: 'g1' }, endpointId: 'bot' };
    const creator = { userId: 'u1', roles: ['owner', 'admin', 'trusted'] as const, chat };
    const lookups: unknown[] = [];
    // Revoked since creation: runs as a plain user.
    expect(currentScheduleCreator({ ...creator, roles: [...creator.roles] }, source => { lookups.push(source); return {}; })?.roles).toEqual(['user']);
    expect(lookups[0]).toEqual({ conversation: chat.conversation, endpointId: 'bot', sender: { id: 'u1' } });
    // A conversation owner has admin host trust; a global owner keeps owner.
    expect(currentScheduleCreator({ ...creator, roles: [] }, () => ({ chatRole: 'owner', chatRoleLevels: { owner: 'conversation' } }))?.roles).toEqual(['admin', 'trusted']);
    expect(currentScheduleCreator({ ...creator, roles: [] }, () => ({ chatRole: 'owner', chatRoleLevels: { owner: 'global' } }))?.roles).toEqual(['owner', 'admin', 'trusted']);
    // An address that no longer resolves fails closed; jobs without an address keep their roles.
    expect(currentScheduleCreator({ ...creator, roles: ['owner'] }, () => undefined)?.roles).toEqual(['user']);
    expect(currentScheduleCreator({ userId: 'u1', roles: ['trusted'] }, () => ({}))?.roles).toEqual(['trusted']);
  });

  it('runs a plain user job with group-member mail trust, and a revoked owner job without master', async () => {
    const mailbox = new HostMailbox();
    const admit = vi.spyOn(mailbox, 'admit');
    const execute = vi.fn(async (): Promise<TaskExecutionResult> => ({ success: true, responseText: 'ok', output: 'ok', durationMs: 1, toolsUsed: [], tokenUsage: { input: 1, output: 1 } }));
    const due = createTimerMailDueHandler({ mailbox: () => mailbox, executor: { execute } as unknown as TaskExecutor, creatorRoles: () => ({}) });
    const job = (createdBy: ScheduleJob['createdBy']): ScheduleJob => ({ id: `j-${createdBy?.userId}`, enabled: true, schedule: { kind: 'every', everyMs: 60_000 },
      action: { kind: 'agent', prompt: 'x' }, notify: { channel: 'silent' }, createdAt: 1, updatedAt: 1, state: {}, createdBy });
    await due.run(job({ userId: 'plain', roles: ['user'] }), { signal: new AbortController().signal, attempt: 1 } as never);
    expect(admit.mock.calls[0]![0]).toMatchObject({ isMaster: false, trust: 'group_member' });
    const chat = { conversation: { endpoint: { adapter: 'root/qq', id: 'qq:bot' }, kind: 'group' as const, id: 'g1' }, endpointId: 'bot' };
    await due.run(job({ userId: 'revoked', roles: ['owner', 'admin', 'trusted'], chat }), { signal: new AbortController().signal, attempt: 1 } as never);
    expect(admit.mock.calls[1]![0]).toMatchObject({ isMaster: false, trust: 'group_member' });
    expect((execute.mock.calls[1] as unknown as [ScheduleJob])[0].createdBy?.roles).toEqual(['user']);
    await mailbox.close();
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

});

describe('task executor schedule creator', () => {
  it('preview uses canonical creator context and captures the domain tool resolution', async () => {
    const executor = createTaskExecutor({
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
      router: createNotificationRouter({ resolveAdapter: () => undefined }),
    });

    const result = await executor.preview('daily weather', {
      sessionKey: 'im:qq:bot:private:u1',
      origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'private', sceneId: 'u1' },
      principal: { subjectId: 'u1', roles: ['owner'] },
    });

    expect(result.success).toBe(true);
    expect(result.responseText).toBe('preview output');
    expect(result.executionPlan).toMatchObject({
      prompt: 'daily weather',
      tools: ['web_search', 'unused_tool'],
      skills: ['weather'],
      previewSample: 'preview output',
      confirmed: false,
    });
  });
});
