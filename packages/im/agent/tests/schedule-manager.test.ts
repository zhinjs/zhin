import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@zhin.js/tool';
import {
  createScheduleTools,
  type ScheduleManager,
} from '../src/schedule-manager.js';

const context = {
  signal: new AbortController().signal,
  traceId: 'trace-schedule',
  turnId: 'turn-schedule',
  sessionKey: 'im:qq:bot:private:u1',
  origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'private', sceneId: 'u1' },
  principal: { subjectId: 'u1', displayName: 'Alice', roles: ['master'] },
} as ToolExecutionContext;

function manager(listJobs: ScheduleManager['engine'] extends infer _T ? () => Promise<unknown[]> : never): ScheduleManager {
  return {
    scheduleFeature: { getStatus: () => [] },
    engine: {
      listJobs,
    } as unknown as NonNullable<ScheduleManager['engine']>,
  };
}

function tool(managerValue: ScheduleManager, name: string) {
  return createScheduleTools(managerValue).find((entry) => entry.name === name)!.definition;
}

describe('canonical schedule tools', () => {
  it('captures the invocation principal and IM target when adding a job', async () => {
    const addJob = vi.fn(async (input) => ({
      ...input,
      createdAt: 1,
      updatedAt: 1,
      state: {},
    }));
    const value = {
      scheduleFeature: { getStatus: () => [] },
      engine: { addJob },
    } as unknown as ScheduleManager;

    const result = await tool(value, 'schedule_add').execute({
      delay_minutes: 5,
      prompt: 'remind me',
      notify_channel: 'im',
    }, context) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(addJob).toHaveBeenCalledWith(expect.objectContaining({
      createdBy: { userId: 'u1', name: 'Alice', roles: ['master'] },
      notify: {
        channel: 'im',
        target: {
          channel: 'im',
          scene: {
            platform: 'qq', endpointKey: 'bot', sceneId: 'u1', kind: 'private', senderId: 'u1',
          },
        },
      },
    }));
  });

  it('keeps each definition bound to its own generation manager', async () => {
    const previous = manager(async () => [{
      id: 'previous', enabled: true, schedule: { kind: 'at', atMs: 1 },
      action: { kind: 'agent', prompt: 'old' }, notify: { channel: 'silent' },
      createdAt: 1, updatedAt: 1, state: {},
    }]);
    const next = manager(async () => [{
      id: 'next', enabled: true, schedule: { kind: 'at', atMs: 2 },
      action: { kind: 'agent', prompt: 'new' }, notify: { channel: 'silent' },
      createdAt: 2, updatedAt: 2, state: {},
    }]);
    const previousTool = tool(previous, 'schedule_list');
    tool(next, 'schedule_list');

    const result = await previousTool.execute({}, context) as { persistent: Array<{ id: string }> };
    expect(result.persistent.map((job) => job.id)).toEqual(['previous']);
  });
});
