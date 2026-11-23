/** #1250 b33: an execution plan without tools or skills falls back to prompt-based selection. */
import { describe, expect, it } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { createScheduleCapabilityPlan, isEmptyExecutionPlan, isScheduleManagementTool } from '../../src/plugin-runtime/schedule-capability-plan.js';
import { describeUnattendedApproval } from '../../src/plugin-runtime/turn-engine-helpers.js';
import { createAutoApprovalPort, ApprovalReviewAgent } from '../../src/session/approval-review-agent.js';

function tool(name: string, description: string, overrides: Partial<ToolCapability> = {}): ToolCapability {
  return {
    owner: rootPluginId(), name, qualifiedName: name, description, requiresApproval: 'on-risk',
    source: `/tools/${name}.ts`, execute: async () => undefined, ...overrides,
  } as ToolCapability;
}

const weather = tool('api60s__skill__60s-life__weather', 'weather forecast 天气 查询 城市天气', { keywords: ['天气', 'weather'] });
const music = tool('music_play', 'play music songs', { keywords: ['music'] });
const prompt = '每天早上查询上海天气 weather 并发早报';

describe('createScheduleCapabilityPlan (#1250 b33)', () => {
  it('falls back to affinity selection for a plan that names no tool and no skill, and warns', () => {
    const plan = createScheduleCapabilityPlan({ prompt, executionPlan: { prompt, confirmed: true }, tools: [weather, music], skills: [] });
    expect(plan.resolvedBy).toBe('affinity');
    expect(plan.resolvedTools.map(t => t.name)).toContain(weather.name);
    expect(plan.capabilities.map(t => t.name)).toContain(weather.name);
    expect(plan.warnings).toEqual(['empty_execution_plan']);
  });

  it('treats empty tool / skill arrays as an empty plan too', () => {
    expect(isEmptyExecutionPlan({ prompt, tools: [], skills: [] })).toBe(true);
    expect(isEmptyExecutionPlan({ prompt, tools: ['x'] })).toBe(false);
    expect(isEmptyExecutionPlan(undefined)).toBe(false);
  });

  it('keeps an explicit plan authoritative (resolvedBy execution-plan) and still reports missing tools', () => {
    const plan = createScheduleCapabilityPlan({ prompt, executionPlan: { prompt, tools: ['music_play', 'gone'] },
      tools: [weather, music], skills: [] });
    expect(plan.resolvedBy).toBe('execution-plan');
    expect(plan.resolvedTools.map(t => t.name)).toEqual(['music_play']);
    expect(plan.missingTools).toEqual(['gone']);
    expect(plan.warnings).toEqual([]);
  });

  it('warns no_tools when resolution yields no tool at all', () => {
    expect(createScheduleCapabilityPlan({ prompt, executionPlan: { prompt, tools: ['gone'] }, tools: [weather], skills: [] }).warnings)
      .toEqual(['no_tools']);
    expect(createScheduleCapabilityPlan({ prompt, executionPlan: { prompt }, tools: [], skills: [] }).warnings)
      .toEqual(['empty_execution_plan', 'no_tools']);
    expect(createScheduleCapabilityPlan({ prompt, tools: [], skills: [] }).warnings).toEqual(['no_tools']);
  });
});

describe('describeUnattendedApproval (#1250 b33)', () => {
  const tools = [
    tool('weather', 'w'),
    tool('readonly_weather', 'w', { readOnly: true }),
    tool('never_weather', 'w', { requiresApproval: 'never' }),
    tool('kick', 'k', { requiresApproval: 'human' }),
  ];
  const unattended = { policy: { unattended: true }, ports: {} };

  it('lists approval tools as denied without a reviewer', () => {
    expect(describeUnattendedApproval(tools, unattended)).toEqual({ review: 'none', denied: ['weather', 'kick'], reviewed: [] });
  });

  it('lists approval tools as reviewed under auto, human-only tools stay denied', () => {
    const port = createAutoApprovalPort(new ApprovalReviewAgent({ judgment: { judge: async () => ({ decision: 'reject' }) } }));
    expect(describeUnattendedApproval(tools, { policy: { unattended: true }, ports: { unattendedReview: port } }))
      .toEqual({ review: 'auto', denied: ['kick'], reviewed: ['weather'] });
  });

  it('says nothing for attended turns', () => {
    expect(describeUnattendedApproval(tools, { policy: { unattended: false }, ports: {} })).toBeUndefined();
  });
});

describe('schedule_preview runs offer no schedule_* tool (#1250 b55)', () => {
  const scheduleAdd = tool('schedule_add', '添加持久化调度任务 定时 提醒 创建任务', { keywords: ['提醒', '定时', '任务'] });
  const scheduleList = tool('schedule_list', '列出调度任务 定时 提醒', { keywords: ['提醒', '定时'] });
  const reminder = tool('send_reminder', '发送提醒 提醒我 喝水', { keywords: ['提醒', '喝水'] });
  // What a model passed to `schedule_preview` instead of the job's content: the whole request.
  const request = '明天 8 点提醒我喝水，创建一个定时任务';

  it('drops schedule_* tools from a preview run, chosen by affinity or named by the plan', () => {
    const live = createScheduleCapabilityPlan({ prompt: request, tools: [scheduleAdd, scheduleList, reminder], skills: [] });
    expect(live.resolvedTools.map(t => t.name)).toContain('schedule_add');

    const preview = createScheduleCapabilityPlan({ prompt: request, tools: [scheduleAdd, scheduleList, reminder], skills: [], preview: true });
    const names = [...preview.allTools, ...preview.resolvedTools, ...preview.capabilities].map(t => t.name);
    expect(names.some(name => name.startsWith('schedule_'))).toBe(false);
    expect(preview.resolvedTools.map(t => t.name)).toContain('send_reminder');

    const planned = createScheduleCapabilityPlan({ prompt: request, executionPlan: { prompt: request, tools: ['schedule_add', 'send_reminder'] },
      tools: [scheduleAdd, reminder], skills: [], preview: true });
    expect(planned.capabilities.map(t => t.name)).toEqual(['send_reminder']);
    expect(planned.missingTools).toEqual(['schedule_add']);
  });

  it('matches qualified names too', () => {
    const qualified = tool('agent__tools__schedule_add', '添加调度任务 提醒', { keywords: ['提醒'] });
    const plan = createScheduleCapabilityPlan({ prompt: request, tools: [qualified, reminder], skills: [], preview: true });
    expect(plan.allTools.map(t => t.name)).toEqual(['send_reminder']);
  });

  it('keeps third-party tools that merely start with schedule_', () => {
    const meeting = tool('mcp__srv__schedule_meeting', '安排会议 提醒 定时', { keywords: ['提醒', '会议'] });
    const plan = createScheduleCapabilityPlan({ prompt: request, tools: [meeting, scheduleAdd, reminder], skills: [], preview: true });
    expect(plan.allTools.map(t => t.name)).toEqual(['mcp__srv__schedule_meeting', 'send_reminder']);
    expect(isScheduleManagementTool('mcp__srv__schedule_meeting')).toBe(false);
    expect(isScheduleManagementTool('schedule_meeting')).toBe(false);
    for (const name of ['schedule_list', 'schedule_add', 'schedule_preview', 'schedule_update', 'schedule_remove', 'schedule_pause', 'schedule_resume']) {
      expect(isScheduleManagementTool(name)).toBe(true);
      expect(isScheduleManagementTool(`plugin__tools__${name}`)).toBe(true);
    }
  });
});
