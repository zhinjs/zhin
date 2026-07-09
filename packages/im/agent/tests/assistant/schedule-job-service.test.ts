import { describe, expect, it, vi } from 'vitest';
import {
  addScheduleJob,
  parseScheduleAddFromRpcMessage,
  parseScheduleAddFromToolArgs,
} from '../../src/assistant/schedule-job-service.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

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
    const message = mockCommMessage({ senderId: 'u1' });
    const result = parseScheduleAddFromToolArgs({
      schedule_kind: 'workday',
      cron: '0 0 9 * * *',
      prompt: 'daily report',
      notify_channel: 'silent',
      execution_plan: { prompt: 'refined', tools: ['a'], skills: ['s1'] },
    }, message);

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
  });

  it('parses delay_minutes as at schedule', () => {
    const result = parseScheduleAddFromToolArgs({
      delay_minutes: 30,
      prompt: 'remind me',
      notify_channel: 'silent',
    });

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.schedule.kind).toBe('at');
    expect(result.schedule.atMs).toBeGreaterThan(Date.now());
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
