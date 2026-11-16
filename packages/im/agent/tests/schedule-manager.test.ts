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
  principal: { subjectId: 'u1', displayName: 'Alice', roles: ['owner'] },
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
      createdBy: { userId: 'u1', name: 'Alice', roles: ['owner'] },
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

describe('schedule tools empty-plan and unattended hints (#1250 b33)', () => {
  function adding() {
    const addJob = vi.fn(async (input: Record<string, unknown>) => ({ ...input, createdAt: 1, updatedAt: 1, state: {} }));
    return { addJob, value: { scheduleFeature: { getStatus: () => [] }, engine: { addJob } } as unknown as ScheduleManager };
  }

  it('accepts a plan without tools or skills but warns that tools will be chosen from the prompt', async () => {
    const { addJob, value } = adding();
    const result = await tool(value, 'schedule_add').execute({
      cron: '0 0 9 * * *', schedule_kind: 'workday', prompt: '天气早报', notify_channel: 'im',
      execution_plan: { prompt: '查询上海天气并发早报' },
    }, context) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(addJob).toHaveBeenCalledOnce();
    expect(result.warning).toContain('schedule_preview');
  });

  it('does not warn when the plan names tools, or when there is no plan', async () => {
    const withTools = adding();
    const named = await tool(withTools.value, 'schedule_add').execute({
      delay_minutes: 5, prompt: '天气', notify_channel: 'im', tools: 'weather',
    }, context) as Record<string, unknown>;
    expect(named.warning).toBeUndefined();
    const plain = adding();
    const none = await tool(plain.value, 'schedule_add').execute({ delay_minutes: 5, prompt: '天气', notify_channel: 'im' }, context) as Record<string, unknown>;
    expect(none.warning).toBeUndefined();
  });

  it('lists in schedule_preview the tools an unattended run cannot use freely', async () => {
    const previewTask = vi.fn(async () => ({
      success: true, responseText: '上海晴', executionPlan: { prompt: 'p', tools: ['weather', 'kick'] },
      audit: { unattendedApproval: { review: 'none', denied: ['weather', 'kick'], reviewed: [] } },
    }));
    const value = { scheduleFeature: { getStatus: () => [] }, engine: null, previewTask } as unknown as ScheduleManager;
    const result = await tool(value, 'schedule_preview').execute({ prompt: '天气' }, context) as Record<string, unknown>;
    expect(result.unattended_approval).toEqual({ review: 'none', denied: ['weather', 'kick'], reviewed: [] });
    expect(result.message).toContain('无人值守执行时，这些工具会被拒绝：`weather`、`kick`');
  });

  it('names reviewed tools under auto review and stays quiet when nothing needs approval', async () => {
    const reviewed = vi.fn(async () => ({ success: true, responseText: 'ok', audit: {
      unattendedApproval: { review: 'auto', denied: [], reviewed: ['weather'] } } }));
    const value = { scheduleFeature: { getStatus: () => [] }, engine: null, previewTask: reviewed } as unknown as ScheduleManager;
    const result = await tool(value, 'schedule_preview').execute({ prompt: '天气' }, context) as Record<string, unknown>;
    expect(result.message).toContain('交给自动审核');
    const quiet = vi.fn(async () => ({ success: true, responseText: 'ok', audit: {
      unattendedApproval: { review: 'auto', denied: [], reviewed: [] } } }));
    const plain = await tool({ ...value, previewTask: quiet } as ScheduleManager, 'schedule_preview').execute({ prompt: '天气' }, context) as Record<string, unknown>;
    expect(plain).not.toHaveProperty('unattended_approval');
  });
});
