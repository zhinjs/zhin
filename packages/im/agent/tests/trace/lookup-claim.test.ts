/**
 * #1250 tool-capability-unverified (part ②): a final reply that claims a lookup while the
 * turn made zero tool calls is flagged in the trace and the decision replay — nothing else.
 */
import { vi } from 'vitest';
import { claimWithoutToolCall, findLookupClaim } from '../../src/trace/lookup-claim.js';
import { TurnTraceCollector } from '../../src/trace/turn-trace.js';
import { auditModelRun } from '../../src/plugin-runtime/ingress/decision-audit.js';

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

describe('lookup claims', () => {
  it.each([
    '我查了一下，X 市现在 25 度，湿度 60%',
    '查到了：明天有雨',
    '根据最新数据，未来三天都是晴天',
    '最新数据显示气温回升',
    'I checked the forecast: sunny all week.',
    "I've looked it up — it's 25°C.",
    'I’ve checked: the store opens at 9.',
    'According to the latest data, it will rain.',
    '根据目前的数据，股价在上涨',
    '根据当前搜索结果，有三家店',
    '我搜索了一下，附近有两家',
  ])('recognizes %j', text => {
    expect(findLookupClaim(text)).toBeTruthy();
  });

  it.each([
    '你好，我能帮你查一下天气吗？',
    '我检查了你的代码，没有问题',
    '他们调查过这件事',
    'Let me check that for you.',
    'I can look it up if you want.',
    '刚卡了一下',
    '根据目前的情况，我建议先休息',
    '根据当前你说的，应该是周三',
    '我没查到相关信息',
    '我没查过这个',
    '还未查到结果',
    '我没有搜到这家店',
    '我搜了一下记忆，好像是 1998 年',
    "I didn't check the weather.",
    "I haven't checked yet.",
    'I haven’t looked it up.',
    'I searched my memory and I think it was 1998.',
    'After a quick search of my memory: 1998.',
  ])('does not flag %j', text => {
    expect(findLookupClaim(text)).toBeUndefined();
  });

  it('flags only turns without any tool call', () => {
    expect(claimWithoutToolCall('我查了一下，晴', 0)).toBe('查了一下');
    expect(claimWithoutToolCall('我查了一下，晴', 1)).toBeUndefined();
  });
});

describe('trace flag', () => {
  it('marks a claimed lookup in a turn with zero tool calls', () => {
    const trace = new TurnTraceCollector({ turnId: 't1', sessionKey: 's' });
    trace.record({ type: 'usage', usage });
    trace.record({ type: 'turn_end', output: [{ type: 'text', content: '查了下，X 市现在 25 度。' }], usage });
    const snapshot = trace.snapshot();
    expect(snapshot.claim_without_tool_call).toEqual({ phrase: '查了下' });
    expect(snapshot.timeline.some(entry => entry.kind === 'claim_without_tool_call')).toBe(true);
  });

  it('checks the final reply of a sub-turn, which records no turn_end', () => {
    const flagged = new TurnTraceCollector({ turnId: 'root:actor:researcher:m1', sessionKey: 's' });
    flagged.record({ type: 'usage', usage });
    flagged.note({ kind: 'final_reply', text: 'I checked: it is sunny.' });
    flagged.finalize({ status: 'completed' });
    expect(flagged.snapshot().claim_without_tool_call).toEqual({ phrase: 'I checked' });
    const backed = new TurnTraceCollector({ turnId: 'root:actor:researcher:m2', sessionKey: 's' });
    backed.record({ type: 'tool_call', toolUseId: 'u1', toolName: 'weather', args: {} } as never);
    backed.note({ kind: 'final_reply', text: 'I checked: it is sunny.' });
    expect(backed.snapshot()).not.toHaveProperty('claim_without_tool_call');
  });

  it('does not mark the same reply when the turn called a tool', () => {
    const trace = new TurnTraceCollector({ turnId: 't2', sessionKey: 's' });
    trace.record({ type: 'tool_call', toolUseId: 'u1', toolName: 'weather', args: { city: 'X' } } as never);
    trace.record({ type: 'turn_end', output: [{ type: 'text', content: '查了下，X 市现在 25 度。' }], usage });
    expect(trace.snapshot()).not.toHaveProperty('claim_without_tool_call');
  });
});

describe('decision replay flag', () => {
  const outcome = (text: string) => ({ status: 'completed' as const, output: [{ type: 'text' as const, content: text }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } });

  it('adds claimWithoutToolCall to the model_run payload, outcome unchanged', () => {
    const audit = vi.fn();
    auditModelRun(audit, outcome('According to the latest data it is sunny.') as never, { model: 'm' }, 0);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'model_run', outcome: 'allow', reasonCode: 'model_completed',
      payload: expect.objectContaining({ model: 'm', toolCalls: 0, claimWithoutToolCall: true, claimPhrase: 'According to the latest data' }) }));
  });

  it('leaves the payload alone with tool calls or an unknown count', () => {
    const audit = vi.fn();
    auditModelRun(audit, outcome('我查了一下') as never, {}, 2);
    auditModelRun(audit, outcome('我查了一下') as never, {});
    for (const [event] of audit.mock.calls) expect(event.payload).not.toHaveProperty('claimWithoutToolCall');
  });
});
