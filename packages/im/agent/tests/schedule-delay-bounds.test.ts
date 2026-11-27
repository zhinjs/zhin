/** #1250 b111: schedule timing inputs are bounded before anything is saved. */
import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { createScheduleTools, type ScheduleManager } from '../src/schedule-manager.js';
import {
  MAX_SCHEDULE_DELAY_MINUTES, parseScheduleAddFromRpcMessage, parseScheduleDelayMinutes,
} from '../src/assistant/schedule-job-service.js';

const context = {
  signal: new AbortController().signal, traceId: 'trace-b111', turnId: 'turn-b111', sessionKey: 'im:qq:bot:private:u1',
  origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'private', sceneId: 'u1' },
  principal: { subjectId: 'u1', displayName: 'Alice', roles: ['owner'] },
} as ToolExecutionContext;

const job = { id: 'sched_1', enabled: true, schedule: { kind: 'solar', cron: '0 0 9 * * *' },
  action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'silent' }, source: 'schedule',
  createdBy: { userId: 'u1', roles: ['owner'] }, createdAt: 1, updatedAt: 1, state: {} };

function tools() {
  const addJob = vi.fn(async (input: Record<string, unknown>) => ({ ...input, createdAt: 1, updatedAt: 1, state: {} }));
  const updateJob = vi.fn(async (_id: string, update: Record<string, unknown>) => ({ ...job, ...update, state: {} }));
  const value = { scheduleFeature: { getStatus: () => [] },
    engine: { addJob, updateJob, listJobs: async () => [job] } } as unknown as ScheduleManager;
  const find = (name: string) => createScheduleTools(value).find(entry => entry.name === name)!.definition;
  return { addJob, updateJob, add: find('schedule_add'), update: find('schedule_update') };
}

describe('schedule delay bounds (#1250 b111)', () => {
  it.each([1e12, MAX_SCHEDULE_DELAY_MINUTES + 1, -5, 1.5, 'abc', Number.NaN])('schedule_add refuses delay_minutes %s and saves nothing', async delay => {
    const { add, addJob } = tools();
    const result = await add.execute({ delay_minutes: delay, prompt: '提醒', notify_channel: 'silent' }, context) as Record<string, unknown>;
    expect(result.error).toMatch(/delay_minutes .*任务未保存/u);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('schedule_add accepts the 365-day maximum and a numeric string', async () => {
    const { add, addJob } = tools();
    const max = await add.execute({ delay_minutes: MAX_SCHEDULE_DELAY_MINUTES, prompt: '提醒', notify_channel: 'silent' }, context) as Record<string, unknown>;
    expect(max.success).toBe(true);
    const text = await add.execute({ delay_minutes: '30', prompt: '提醒', notify_channel: 'silent' }, context) as Record<string, unknown>;
    expect(text.success).toBe(true);
    expect(addJob).toHaveBeenCalledTimes(2);
  });

  it('schedule_add keeps a zero delay next to a cron as no delay', async () => {
    const { add, addJob } = tools();
    const result = await add.execute({ delay_minutes: 0, cron: '0 0 9 * * *', prompt: '提醒', notify_channel: 'silent' }, context) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(addJob.mock.calls[0]![0].schedule).toMatchObject({ kind: 'solar' });
  });

  it.each([1e12, MAX_SCHEDULE_DELAY_MINUTES + 1, 2.5])('schedule_update refuses delay_minutes %s and changes nothing', async delay => {
    const { update, updateJob } = tools();
    const result = await update.execute({ id: 'sched_1', delay_minutes: delay }, context) as Record<string, unknown>;
    expect(result.error).toMatch(/delay_minutes .*任务未保存/u);
    expect(updateJob).not.toHaveBeenCalled();
  });

  it('RPC at_ms must be a future time at most 365 days ahead', () => {
    const now = Date.now();
    const base = { prompt: 'p', schedule_kind: 'at' };
    expect(parseScheduleAddFromRpcMessage({ ...base, at_ms: 8.64e15 + 1 })).toMatchObject({ error: expect.stringContaining('at_ms') });
    expect(parseScheduleAddFromRpcMessage({ ...base, at_ms: now - 1000 })).toMatchObject({ error: expect.stringContaining('at_ms') });
    expect(parseScheduleAddFromRpcMessage({ ...base, at_ms: now + 400 * 86_400_000 })).toMatchObject({ error: expect.stringContaining('365') });
    expect(parseScheduleAddFromRpcMessage({ ...base, at_ms: now + 60_000 })).toMatchObject({ schedule: { kind: 'at', atMs: now + 60_000 } });
  });

  it('refuses a run budget past the timer limit', async () => {
    const { add, addJob } = tools();
    const result = await add.execute({ delay_minutes: 5, prompt: '提醒', notify_channel: 'silent', budget_timeout_ms: 2 ** 31 }, context) as Record<string, unknown>;
    expect(result.error).toContain('budget_timeout_ms');
    expect(addJob).not.toHaveBeenCalled();
  });

  it('parses delays as whole minutes', () => {
    expect(parseScheduleDelayMinutes(5)).toBe(5);
    expect(parseScheduleDelayMinutes('')).toMatchObject({ error: expect.any(String) });
  });
});
