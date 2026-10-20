import { describe, expect, it } from 'vitest';
import { assembleSchedulePrompt } from '../../src/schedule-domain/prompt-assembler.js';

describe('assembleSchedulePrompt', () => {
  it('builds an execution-only system prompt without chat persona', () => {
    const result = assembleSchedulePrompt({
      jobId: 'sched_weather',
      prompt: '发布天气预报',
      createdBy: { userId: 'u1', name: 'Alice', roles: ['master'] },
      now: new Date('2026-08-12T01:00:00.000Z'),
      timeZone: 'Asia/Shanghai',
      bootstrapContext: 'Workspace rule',
      memoryContext: 'Known preference',
      platformContext: 'Platform: qq',
    });

    expect(result.systemPrompt).toContain('定时任务执行引擎');
    expect(result.systemPrompt).toContain('sched_weather');
    expect(result.systemPrompt).toContain('Workspace rule');
    expect(result.systemPrompt).toContain('Known preference');
    expect(result.systemPrompt).not.toContain('You are Zhin');
    expect(result.userPrompt).toBe('发布天气预报');
  });

  it('describes the effective execution preset', () => {
    const result = assembleSchedulePrompt({
      jobId: 'sched_network',
      prompt: 'fetch report',
      security: { execPreset: 'network', rejectOwnerApproval: true, allowedDomains: [] },
    });
    expect(result.systemPrompt).toContain('Shell 仅允许 network preset');
  });
});
