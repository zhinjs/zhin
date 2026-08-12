import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import { ScheduleExecutionDomainImpl } from '../../src/schedule-domain/execution-domain.js';
import type { ScheduleJob } from '../../src/assistant/types.js';

const job: ScheduleJob = {
  id: 'sched_weather',
  enabled: true,
  schedule: { kind: 'every', everyMs: 60_000 },
  action: { kind: 'agent', prompt: '发布天气' },
  notify: { channel: 'silent' },
  createdAt: 1,
  updatedAt: 1,
  state: {},
  createdBy: { userId: 'u1', roles: ['master'] },
};

describe('ScheduleExecutionDomain', () => {
  it('runs a schedule turn with budget telemetry, output validation, and audit', async () => {
    const write = vi.fn(async () => {});
    const processTurn = vi.fn(async (request: any) => {
      request.scheduleContext.toolResolution = {
        tools: ['weather_lookup'],
        skills: [],
        resolvedBy: 'affinity',
        missingTools: [],
        missingSkills: [],
      };
      request.onTurnEvent?.({ type: 'tool_call', toolName: 'weather_lookup', args: {}, toolUseId: '1' });
      request.onTurnEvent?.({
        type: 'turn_end',
        output: [],
        usage: { promptTokens: 120, completionTokens: 20, totalTokens: 140 },
      });
      return [{ type: 'text', content: '收到，正在执行。\n\n上海今日多云。' }];
    });
    const domain = new ScheduleExecutionDomainImpl({
      agent: { processTurn, config: DEFAULT_CONFIG },
      auditLogger: { write },
    });

    const result = await domain.execute(job, {} as any);

    expect(result.success).toBe(true);
    expect(result.output).toBe('上海今日多云。');
    expect(result.toolsUsed).toEqual(['weather_lookup']);
    expect(result.tokenUsage).toEqual({ input: 120, output: 20 });
    expect(result.audit.toolsResolved).toEqual(['weather_lookup']);
    expect(write).toHaveBeenCalledWith(result.audit);
    expect(processTurn).toHaveBeenCalledWith(expect.objectContaining({
      content: '发布天气',
      scheduleContext: expect.objectContaining({ jobId: 'sched_weather' }),
    }));
  });
});
