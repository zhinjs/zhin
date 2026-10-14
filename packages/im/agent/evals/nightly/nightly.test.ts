import { describe, expect, it } from 'vitest';
import { EMPTY_TOKEN_USAGE, type AssistantMessage, type LlmCompletionPort, type Model } from '@zhin.js/ai';
import { BudgetExceededError, BudgetedCompletionPort, DEFAULT_NIGHTLY_BUDGET, resolveNightlyBudget } from './budget.js';
import { CAPABILITY_MATRIX, buildHaystack } from './matrix-cases.js';
import { diffReports, renderMarkdown, summarizeCase, type NightlyReport } from './report.js';
import { runNightlyMatrix } from './runner.js';
import { observe, semantic } from './semantic.js';

const model = { id: 'm1', provider: 'minimax', api: 'ai-sdk', sdk: 'minimax', input: ['text'], reasoning: false, maxTokens: 1000, contextWindow: 100_000 } as unknown as Model;

function message(content: AssistantMessage['content'], totalTokens = 100): AssistantMessage {
  return {
    role: 'assistant', content, api: 'ai-sdk', provider: 'minimax', model: 'm1',
    usage: { ...EMPTY_TOKEN_USAGE, totalTokens }, stopReason: 'stop', timestamp: 0,
  };
}
const text = (t: string) => message([{ type: 'text', text: t }]);
const calls = (...cities: string[]) => message(cities.map((city, i) => ({ type: 'toolCall', id: `c${i}`, name: 'get_weather', arguments: { city } })));

function userText(message: unknown): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.map((block: { text?: string }) => block.text ?? '').join('') : '';
}

/** Fake provider answering each matrix case by its user prompt. */
function fakePort(answer: (user: string) => AssistantMessage): LlmCompletionPort {
  return {
    complete: async (_m, ctx) => answer(userText(ctx.messages[0])),
    completeSimple: async () => { throw new Error('unused'); },
  };
}

const perfect = (user: string) => {
  if (user.includes('上海现在天气')) return calls('上海');
  if (user.includes('北京和广州')) return calls('北京', '广州');
  if (user.includes('暗号是什么')) return text('青柠-4721');
  return text('- 精神更好\n- 皮肤更好\n- 记忆力更强');
};

describe('nightly budget', () => {
  it('has conservative documented defaults and ignores invalid overrides', () => {
    expect(DEFAULT_NIGHTLY_BUDGET).toMatchObject({ maxRequests: 60, maxTotalTokens: 200_000, runsPerCase: 3 });
    expect(resolveNightlyBudget({ NIGHTLY_RUNS_PER_CASE: '0', NIGHTLY_MAX_REQUESTS: '10' })).toMatchObject({ runsPerCase: 3, maxRequests: 10 });
  });

  it('stops at the request cap and clamps output tokens', async () => {
    const seen: Array<number | undefined> = [];
    const port = new BudgetedCompletionPort({
      complete: async (_m, _c, o) => { seen.push(o?.maxTokens); return text('ok'); },
      completeSimple: async () => text('ok'),
    }, { ...DEFAULT_NIGHTLY_BUDGET, maxRequests: 2, maxOutputTokens: 256 });
    const ctx = { systemPrompt: '', messages: [] };
    await port.complete(model, ctx, { maxTokens: 4096 });
    await port.complete(model, ctx);
    await expect(port.complete(model, ctx)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(seen).toEqual([256, 256]);
    expect(port.usage()).toEqual({ requests: 2, totalTokens: 200 });
  });
});

describe('semantic checks', () => {
  it('judge tool calls, facts, language and format', () => {
    expect(semantic.toolArgsCover(observe(calls('北京', '广州')), 'get_weather', 'city', [/北京/, /广州/]).pass).toBe(true);
    expect(semantic.calledTool(observe(calls('北京')), 'get_weather', 2).pass).toBe(false);
    expect(semantic.textIsChinese(observe(text('早睡让人精神饱满，第二天 OK'))).pass).toBe(true);
    expect(semantic.textIsChinese(observe(text('Sleep early is good for health'))).pass).toBe(false);
    expect(semantic.bulletLines(observe(text('好处如下：\n- a\n- b\n- c')), '- ', 3).pass).toBe(false);
  });

  it('buries the needle mid-haystack', () => {
    const hay = buildHaystack('NEEDLE', 10);
    expect(hay.indexOf('NEEDLE')).toBeGreaterThan(hay.length / 3);
  });
});

describe('matrix runner and report', () => {
  const budget = { ...DEFAULT_NIGHTLY_BUDGET, runsPerCase: 2 };
  const clock = () => new Date('2026-10-14T00:00:00Z');

  it('passes every capability with ideal answers and reports averages', async () => {
    const port = new BudgetedCompletionPort(fakePort(perfect), budget);
    const report = await runNightlyMatrix({ provider: 'minimax', models: [model], cases: CAPABILITY_MATRIX, port, budget, now: clock });
    const cases = report.models[0]!.cases;
    expect(cases.map((c) => c.capability)).toEqual(['tool-call-format', 'parallel-calls', 'long-context', 'zh-instruction']);
    expect(cases.every((c) => c.passRate === 1)).toBe(true);
    expect(cases.find((c) => c.id === 'matrix-parallel-calls')?.avgToolCalls).toBe(2);
    expect(report.budget.requests).toBe(8);
  });

  it('marks the remainder skipped once the budget is exhausted', async () => {
    const tight = { ...budget, maxRequests: 3 };
    const report = await runNightlyMatrix({ provider: 'minimax', models: [model], cases: CAPABILITY_MATRIX, port: new BudgetedCompletionPort(fakePort(perfect), tight), budget: tight, now: clock });
    expect(report.stoppedByBudget).toBe(true);
    expect(report.budget.requests).toBe(3);
    expect(report.models[0]!.cases.at(-1)?.passRate).toBeNull();
  });

  it('records provider errors as failures without aborting the run', async () => {
    const port = new BudgetedCompletionPort(fakePort(() => { throw new Error('HTTP 503'); }), budget);
    const report = await runNightlyMatrix({ provider: 'minimax', models: [model], cases: CAPABILITY_MATRIX.slice(0, 1), port, budget, now: clock });
    expect(report.models[0]!.cases[0]).toMatchObject({ passRate: 0, failures: ['provider error: HTTP 503', 'provider error: HTTP 503'] });
  });

  it('diffs against the previous report and flags regressions', () => {
    const base = (rate: number): NightlyReport => ({
      version: 1, startedAt: '2026-10-13T00:00:00Z', finishedAt: '2026-10-13T00:01:00Z', provider: 'minimax',
      budget: { requests: 1, totalTokens: 1, maxRequests: 60, maxTotalTokens: 200_000 }, stoppedByBudget: false,
      models: [{ model: 'm1', cases: [summarizeCase('matrix-zh-instruction', 'zh-instruction', [
        { pass: rate >= 0.5, checks: [], totalTokens: 10, toolCalls: 0 },
        { pass: rate >= 1, checks: [], totalTokens: 10, toolCalls: 0 },
      ])] }],
    });
    const diffs = diffReports(base(1), base(0));
    expect(diffs).toEqual([expect.objectContaining({ id: 'matrix-zh-instruction', previous: 1, current: 0, status: 'regressed' })]);
    expect(diffReports(undefined, base(1))[0]?.status).toBe('new');
    expect(renderMarkdown(base(0), diffs)).toContain('**Regressions:** m1/matrix-zh-instruction');
  });
});
