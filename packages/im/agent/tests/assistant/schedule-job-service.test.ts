import { describe, expect, it, vi } from 'vitest';
import {
  addScheduleJob,
  parseScheduleAddFromRpcMessage,
  parseScheduleAddFromToolArgs,
} from '../../src/assistant/schedule-job-service.js';

const toolContext = {
  sessionKey: 'im:qq:bot:private:u1',
  origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'private', sceneId: 'u1' },
  principal: { subjectId: 'u1', displayName: 'Alice', roles: ['master'] },
} as const;

describe('addScheduleJob', () => {
  it('persists execution plan prompt as action prompt', async () => {
    const addJob = vi.fn(async (job) => job);
    const engine = { addJob } as any;

    await addScheduleJob(engine, {
      prompt: 'original',
      schedule: { kind: 'solar', cron: '0 0 9 * * *' },
      notify: { channel: 'silent' },
      executionPlan: { prompt: 'refined', tools: ['web_search'], confirmed: true },
    });

    expect(addJob).toHaveBeenCalledWith(expect.objectContaining({
      action: { kind: 'agent', prompt: 'refined' },
      executionPlan: expect.objectContaining({ prompt: 'refined', tools: ['web_search'] }),
    }));
  });
});

describe('parseScheduleAddFromToolArgs', () => {
  it('parses workday cron schedule with execution plan', () => {
    const result = parseScheduleAddFromToolArgs({
      schedule_kind: 'workday',
      cron: '0 0 9 * * *',
      prompt: 'daily report',
      notify_channel: 'im',
      execution_plan: { prompt: 'refined', tools: ['a'], skills: ['s1'] },
    }, toolContext);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.schedule).toMatchObject({ kind: 'workday', cron: '0 0 9 * * *' });
    expect(result.executionPlan).toMatchObject({
      prompt: 'refined',
      tools: ['a'],
      skills: ['s1'],
      confirmed: true,
    });
    expect(result.createdBy?.userId).toBe('u1');
    expect(result.notify).toMatchObject({
      channel: 'im',
      target: { scene: { platform: 'qq', endpointKey: 'bot', sceneId: 'u1', kind: 'private' } },
    });
  });

  it('parses delay_minutes as at schedule', () => {
    const result = parseScheduleAddFromToolArgs({
      delay_minutes: 30,
      prompt: 'remind me',
      notify_channel: 'silent',
    }, toolContext);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.schedule.kind).toBe('at');
    expect(result.schedule.atMs).toBeGreaterThan(Date.now());
  });

  it('fails closed when IM notify has no IM origin', () => {
    const result = parseScheduleAddFromToolArgs({
      delay_minutes: 30,
      prompt: 'remind me',
    }, {
      ...toolContext,
      origin: { kind: 'http', sessionId: 'http-1' },
    });
    expect(result).toEqual({ error: 'IM notify requires an IM invocation origin' });
  });
});

describe('parseScheduleAddFromRpcMessage', () => {
  it('parses RPC payload with notify and execution plan parity', () => {
    const result = parseScheduleAddFromRpcMessage({
      scheduleKind: 'solar',
      cron: '0 0 8 * * *',
      prompt: 'morning',
      notify: { channel: 'silent' },
      executionPlan: { prompt: 'refined morning', tools: ['t1'] },
      activityFeedback: true,
      createdBy: { userId: 'rpc-user', roles: ['master'] },
    });

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.schedule).toMatchObject({ kind: 'solar', cron: '0 0 8 * * *' });
    expect(result.activityFeedback).toBe(true);
    expect(result.createdBy).toMatchObject({ userId: 'rpc-user', roles: ['master'] });
    expect(result.executionPlan?.confirmed).toBe(true);
  });
});
