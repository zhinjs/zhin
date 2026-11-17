/**
 * #1250 b40 schedule-failed-run-marked-ok: a scheduled turn that ended on a failed model request
 * (`llm_error`, its reply the failure text) is a failed run, not `ok`.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import { ScheduleExecutionDomainImpl } from '../../src/schedule-domain/execution-domain.js';
import { isTransientModelFailure } from '../../src/schedule-domain/model-failure.js';
import type { ScheduleJob } from '../../src/assistant/types.js';
import type { TurnEvent } from '../../src/event/turn-event.js';
import type { TurnOutcome } from '../../src/turn/turn-ingress.js';

const job: ScheduleJob = {
  id: 'sched_weather', label: '工作日天气早报', enabled: true,
  schedule: { kind: 'workday', cron: '0 0 9 * * *' },
  action: { kind: 'agent', prompt: '查询今天上海天气并发早报' },
  notify: { channel: 'silent' }, createdAt: 1, updatedAt: 1, state: {},
};
const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
const legacyUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

function domain(events: TurnEvent[], outcome: TurnOutcome) {
  return new ScheduleExecutionDomainImpl({ config: DEFAULT_CONFIG, auditLogger: { write: async () => {} },
    turn: { execute: async request => {
      for (const event of events) request.onTurnEvent(event);
      return outcome;
    } } });
}

describe('ScheduleExecutionDomain model failures (#1250 b40)', () => {
  it('fails a turn that ended on a network error, with its kind, service and trace id', async () => {
    const text = '连接模型服务失败，请检查网络后再试。';
    const result = await domain([
      { type: 'turn_end', output: [{ type: 'text', content: text }], usage,
        modelFailure: { kind: 'network', message: '连接模型服务失败，请检查网络后再试', service: '中转站' } },
    ], { status: 'completed', output: [{ type: 'text', content: text }], usage: legacyUsage }).execute(job);
    expect(result).toMatchObject({ success: false, status: 'failed',
      modelFailure: { kind: 'network', transient: true, service: '中转站' } });
    expect(result.error).toBe(`模型调用失败（network）：连接模型服务失败，请检查网络后再试；排查：zhin trace ${result.audit.executionId}`);
    expect(result.audit.success).toBe(false);
  });

  it('marks a rejected credential as a model failure that a retry cannot fix', async () => {
    const result = await domain([
      { type: 'turn_end', output: [], usage, modelFailure: { kind: 'auth', message: '模型服务鉴权失败，请检查 API 密钥配置' } },
    ], { status: 'completed', output: [{ type: 'text', content: 'x' }], usage: legacyUsage }).execute(job);
    expect(result).toMatchObject({ success: false, modelFailure: { kind: 'auth', transient: false } });
  });

  it('recognises a turn that failed with a provider failure message', async () => {
    const result = await domain([], { status: 'failed', usage: legacyUsage,
      error: { code: 'turn_error', message: '模型服务暂时不可用，请稍后再试', retryable: true } }).execute(job);
    expect(result).toMatchObject({ success: false, modelFailure: { kind: 'server', transient: true } });
    expect(result.error).toContain('模型调用失败（server）');
  });

  it('keeps an answered turn as succeeded', async () => {
    const result = await domain([
      { type: 'tool_call', toolName: 'weather', args: {}, toolUseId: '1' },
      { type: 'tool_result', toolName: 'weather', output: 'sunny', durationMs: 1, toolUseId: '1' },
      { type: 'turn_end', output: [], usage },
    ], { status: 'completed', output: [{ type: 'text', content: '上海晴。' }], usage: legacyUsage }).execute(job);
    expect(result).toMatchObject({ success: true, status: 'succeeded' });
    expect(result.modelFailure).toBeUndefined();
  });

  it('treats network, 5xx and timeouts as temporary', () => {
    expect(['network', 'server', 'timeout', 'no_response'].every(isTransientModelFailure)).toBe(true);
    expect(['auth', 'billing', 'quota_exhausted', 'bad_request', 'unknown'].some(isTransientModelFailure)).toBe(false);
  });
});
