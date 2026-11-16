/** #1250 b33: a scheduled run that finished without doing what was asked is recorded as degraded. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import { ScheduleExecutionDomainImpl, detectDegradation, describeDegradation } from '../../src/schedule-domain/execution-domain.js';
import type { ScheduleJob } from '../../src/assistant/types.js';
import type { TurnEvent } from '../../src/event/turn-event.js';
import { formatToolCallsForUser } from '../../src/core/tool-calls-user-format.js';

const job: ScheduleJob = {
  id: 'sched_weather',
  label: '天气早报',
  enabled: true,
  schedule: { kind: 'workday', cron: '0 0 9 * * *' },
  action: { kind: 'agent', prompt: '查询今天上海天气并发早报' },
  notify: { channel: 'silent' },
  createdAt: 1,
  updatedAt: 1,
  state: {},
  createdBy: { userId: 'u1', roles: ['owner'] },
};

function domainWith(events: TurnEvent[], output: string) {
  return new ScheduleExecutionDomainImpl({ config: DEFAULT_CONFIG, auditLogger: { write: async () => {} },
    turn: { execute: async request => {
      for (const event of events) request.onTurnEvent(event);
      return { status: 'completed', output: [{ type: 'text', content: output }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    } } });
}

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

describe('ScheduleExecutionDomain degraded runs (#1250 b33)', () => {
  it('marks a run whose reply is the fallback for "no tools" as degraded, names the job and its trace, and never says /reset', async () => {
    const fallbackText = formatToolCallsForUser([], { toolsAvailable: false, schedule: { jobId: job.id, turnId: 'x' } });
    const result = await domainWith([
      { type: 'capability_resolution', mode: 'direct', resolvedBy: 'execution-plan', tools: [], skills: [],
        missingTools: [], missingSkills: [], warnings: ['no_tools'] },
      { type: 'turn_end', output: [], usage, fallback: { cause: 'no_tools' } },
    ], fallbackText).execute(job, { attempt: undefined });
    expect(result).toMatchObject({ success: true, status: 'degraded', degraded: { cause: 'no_tools', fallback: true } });
    expect(result.error).toContain('没有可用的工具');
    expect(result.error).toContain(`zhin trace ${result.audit.executionId}`);
    expect(result.output).toContain('「天气早报」（sched_weather）');
    expect(result.output).toContain(`zhin trace ${result.audit.executionId}`);
    expect(result.output).not.toContain('/reset');
    expect(result.audit).toMatchObject({ warnings: ['no_tools'], degraded: { cause: 'no_tools' } });
  });

  it('marks a run with a denied tool as degraded even when the model still replied', async () => {
    const result = await domainWith([
      { type: 'tool_call', toolName: 'api60s__skill__60s-life__weather', args: {}, toolUseId: '1' },
      { type: 'tool_denied', toolName: 'api60s__skill__60s-life__weather', toolUseId: '1', policy: 'approval', reason: 'unattended' },
      { type: 'turn_end', output: [], usage },
    ], '今天没能查到天气。').execute(job);
    expect(result).toMatchObject({ success: true, status: 'degraded',
      degraded: { cause: 'tool_denied', tools: ['api60s__skill__60s-life__weather'], fallback: false } });
    expect(result.error).toContain('`api60s__skill__60s-life__weather`');
    expect(result.output).toBe('今天没能查到天气。');
  });

  it('keeps a run with tool results and a real reply as succeeded', async () => {
    const result = await domainWith([
      { type: 'tool_call', toolName: 'weather', args: {}, toolUseId: '1' },
      { type: 'tool_result', toolName: 'weather', output: 'sunny', durationMs: 1, toolUseId: '1' },
      { type: 'turn_end', output: [], usage },
    ], '上海晴。').execute(job);
    expect(result).toMatchObject({ success: true, status: 'succeeded' });
    expect(result.error).toBeUndefined();
    expect(result.degraded).toBeUndefined();
  });

  it('detects the causes in order: fallback, denial, then no tool result with an empty reply', () => {
    expect(detectDegradation({ fallback: { cause: 'empty_reply' }, denials: [], toolResults: 0, reply: 'x' }))
      .toEqual({ cause: 'empty_reply', fallback: true });
    expect(detectDegradation({ fallback: { cause: 'empty_reply' }, denials: [{ tool: 't', policy: 'approval', reason: 'r' }], toolResults: 0, reply: '' }))
      .toEqual({ cause: 'tool_denied', tools: ['t'], fallback: true });
    expect(detectDegradation({ denials: [], toolResults: 0, reply: '  ' })).toEqual({ cause: 'empty_reply', fallback: false });
    expect(detectDegradation({ denials: [], toolResults: 0, reply: 'ok' })).toBeUndefined();
    expect(describeDegradation({ cause: 'empty_reply', fallback: false }, 'turn-1')).toBe('模型没有返回可见内容；排查：zhin trace turn-1');
  });
});
