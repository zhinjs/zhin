import { describe, expect, it } from 'vitest';
import { buildBootstrapContextSection } from '../../src/bootstrap.js';
import { assembleSchedulePrompt } from '../../src/schedule-domain/prompt-assembler.js';

describe('assembleSchedulePrompt', () => {
  it('builds an execution-only system prompt without chat persona', () => {
    const result = assembleSchedulePrompt({
      jobId: 'sched_weather',
      prompt: '发布天气预报',
      createdBy: { userId: 'u1', name: 'Alice', roles: ['owner'] },
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

  it('keeps already-formatted workspace files under one heading', () => {
    const bootstrapContext = buildBootstrapContextSection([{ path: 'TOOLS.md', content: 'Use verified tool results.' }]);
    const { systemPrompt } = assembleSchedulePrompt({ jobId: 'scheduled', prompt: 'Generate report', bootstrapContext });
    expect(systemPrompt.match(/^# Workspace.*$/gmu)).toHaveLength(1);
    expect(systemPrompt).toContain('## TOOLS.md\n\nUse verified tool results.');
    expect(systemPrompt).toContain('无人值守审批一律拒绝');
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
