import { aiOutboundJsonSchema } from '@zhin.js/core';
import { describe, expect, it } from 'vitest';
import { EMPTY_TOKEN_USAGE, type AssistantMessage, type LlmCompletionPort, type Model } from '@zhin.js/ai';
import { BudgetExceededError, BudgetedCompletionPort, DEFAULT_NIGHTLY_BUDGET, resolveNightlyBudget } from './budget.js';
import { CAPABILITY_MATRIX, buildHaystack } from './matrix-cases.js';
import { DEFAULT_NIGHTLY_MODEL, resolveNightlyModels, resolveNightlyProvider } from './providers.js';
import { diffReports, renderMarkdown, summarizeCase, type NightlyReport } from './report.js';
import { runNightlyMatrix } from './runner.js';
import { liveSeedCases } from './seed-cases.js';
import groupMemberNoShell from '../cases/group-member-no-shell.case.js';
import sessionHistoryCarried from '../cases/session-history-carried.case.js';
import { observe, semantic } from './semantic.js';

const model = { id: 'm1', provider: 'minimax', api: 'ai-sdk', sdk: 'minimax', input: ['text'], reasoning: false, maxTokens: 1000, contextWindow: 100_000 } as unknown as Model;
const visionModel = { ...model, id: 'g1', provider: 'gemini', sdk: 'google', input: ['text', 'image'] } as unknown as Model;

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

/** Fake provider answering each matrix case by its user prompt; records request options and image counts. */
function fakePort(answer: (user: string) => AssistantMessage, seen: Array<{ temperature?: number; images: number }> = []): LlmCompletionPort {
  return {
    complete: async (_m, ctx, options) => {
      const media = (ctx.messages[0] as { media?: Array<{ type: string; data: { media: { mime_type?: string } } }> }).media ?? [];
      seen.push({ temperature: options?.temperature, images: media.filter((b) => b.type === 'image' && b.data.media.mime_type === 'image/png').length });
      return answer(userText(ctx.messages[0]));
    },
    completeSimple: async () => { throw new Error('unused'); },
  };
}

const perfect = (user: string) => {
  if (user.includes('上海现在天气')) return calls('上海');
  if (user.includes('北京和广州')) return calls('北京', '广州');
  if (user.includes('暗号是什么')) return text('青柠-4721');
  if (user.includes('颜色的什么形状')) return text('红色圆形');
  return text('- 精神更好\n- 皮肤更好\n- 记忆力更强');
};

describe('nightly budget', () => {
  it('has conservative documented defaults and ignores invalid overrides', () => {
    expect(DEFAULT_NIGHTLY_BUDGET).toMatchObject({ maxRequests: 120, maxTotalTokens: 600_000, runsPerCase: 3 });
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

describe('nightly provider selection', () => {
  it('defaults to Gemini with its key, thinking level and no temperature', () => {
    const gemini = resolveNightlyProvider({ GEMINI_API_KEY: ' k ' });
    expect(gemini).toMatchObject({ id: 'gemini', keyEnv: 'GEMINI_API_KEY', temperature: undefined });
    expect(gemini.config).toMatchObject({ sdk: 'google', apiKey: 'k', providerOptions: { google: { thinkingConfig: { thinkingLevel: 'low' } } } });
    expect(resolveNightlyModels({}, gemini)).toEqual([DEFAULT_NIGHTLY_MODEL]);
    expect(resolveNightlyModels({ NIGHTLY_MODELS: 'a, b,' }, gemini)).toEqual(['a', 'b']);
    expect(resolveNightlyProvider({ NIGHTLY_THINKING_LEVEL: 'off' }).config.providerOptions).toBeUndefined();
  });

  it('keeps MiniMax available and rejects unknown providers', () => {
    const minimax = resolveNightlyProvider({ NIGHTLY_PROVIDER: 'minimax', MINIMAX_API_KEY: 'k', GEMINI_API_KEY: 'g' });
    expect(minimax).toMatchObject({ id: 'minimax', keyEnv: 'MINIMAX_API_KEY', temperature: 0.2, config: { sdk: 'minimax', apiKey: 'k' } });
    expect(resolveNightlyModels({}, minimax)).toEqual(['minimax-m3']);
    expect(resolveNightlyProvider({ NIGHTLY_PROVIDER: 'gemini' }).config.apiKey).toBeUndefined();
    expect(() => resolveNightlyProvider({ NIGHTLY_PROVIDER: 'openai' })).toThrow(/Unknown NIGHTLY_PROVIDER/);
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
    const seen: Array<{ temperature?: number; images: number }> = [];
    const port = new BudgetedCompletionPort(fakePort(perfect, seen), budget);
    const report = await runNightlyMatrix({ provider: 'gemini', models: [visionModel], cases: CAPABILITY_MATRIX, port, budget, now: clock });
    const cases = report.models[0]!.cases;
    expect(cases.map((c) => c.capability)).toEqual(['tool-call-format', 'parallel-calls', 'long-context', 'zh-instruction', 'multimodal']);
    expect(cases.every((c) => c.passRate === 1)).toBe(true);
    expect(cases.find((c) => c.id === 'matrix-parallel-calls')?.avgToolCalls).toBe(2);
    expect(report.budget.requests).toBe(10);
    // The image rides on the multimodal case only; no temperature unless the provider asks for one.
    expect(seen.map((s) => s.images)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
    expect(seen.every((s) => s.temperature === undefined)).toBe(true);
  });

  it('skips the multimodal column for text-only models without spending a request', async () => {
    const seen: Array<{ temperature?: number; images: number }> = [];
    const port = new BudgetedCompletionPort(fakePort(perfect, seen), budget);
    const report = await runNightlyMatrix({ provider: 'minimax', models: [model], cases: CAPABILITY_MATRIX, port, budget, now: clock, temperature: 0.2 });
    const multimodal = report.models[0]!.cases.find((c) => c.capability === 'multimodal');
    expect(multimodal).toMatchObject({ skipped: 2, passRate: null });
    expect(report.budget.requests).toBe(8);
    expect(seen.every((s) => s.temperature === 0.2)).toBe(true);
  });

  it('fails the multimodal case when the answer misses the colour or shape', async () => {
    const port = new BudgetedCompletionPort(fakePort(() => text('蓝色正方形')), budget);
    const multimodalCase = CAPABILITY_MATRIX.filter((c) => c.capability === 'multimodal');
    const report = await runNightlyMatrix({ provider: 'gemini', models: [visionModel], cases: multimodalCase, port, budget, now: clock });
    expect(report.models[0]!.cases[0]).toMatchObject({ passRate: 0 });
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

describe('seed cases on the live model hook', () => {
  const budget = { ...DEFAULT_NIGHTLY_BUDGET, runsPerCase: 1 };
  const clock = () => new Date('2026-10-14T00:00:00Z');
  const lastUser = (ctx: { messages: readonly unknown[] }) => userText([...ctx.messages].reverse().find((m) => (m as { role?: string }).role === 'user'));
  const portFor = (answer: (user: string, offered: readonly string[]) => AssistantMessage): LlmCompletionPort => ({
    complete: async (_m, ctx, options) => {
      const response = answer(lastUser(ctx), (ctx.tools ?? []).map((t) => t.name));
      if (options?.outputSchema === aiOutboundJsonSchema && response.content.every(block => block.type === 'text')) {
        return { ...response, content: [{ type: 'text', text: JSON.stringify({ segments: response.content.map(block => ({
          type: 'text', data: { text: block.type === 'text' ? block.text : '' },
        })) }) }] };
      }
      return response;
    },
    completeSimple: async () => { throw new Error('unused'); },
  });
  const seeds = liveSeedCases([groupMemberNoShell, sessionHistoryCarried]);

  it('replays seed cases through the driver and grades them with live checks', async () => {
    const seen: string[][] = [];
    const port = new BudgetedCompletionPort(portFor((user, offered) => {
      seen.push([...offered]);
      if (user.includes('rm -rf')) return text('抱歉，群成员发起的对话不能执行命令。');
      if (user.includes('代号是什么')) return text('代号是青鸟。');
      return text('好的，记住了。');
    }), budget);
    const report = await runNightlyMatrix({ provider: 'minimax', models: [model], cases: [], seedCases: seeds, port, budget, now: clock });
    const cases = report.models[0]!.cases;
    expect(cases.map((c) => [c.id, c.capability, c.passRate])).toEqual([
      ['seed-group-member-no-shell', 'seed-case', 1],
      ['seed-session-history-carried', 'seed-case', 1],
    ]);
    expect(seen.every((offered) => !offered.includes('bash'))).toBe(true);
    expect(report.budget.requests).toBe(3);
  });

  it('fails a seed case when the real answer misses the semantic check', async () => {
    const port = new BudgetedCompletionPort(portFor(() => text('好的，马上执行。')), budget);
    const report = await runNightlyMatrix({ provider: 'minimax', models: [model], cases: [], seedCases: seeds.slice(0, 1), port, budget, now: clock });
    expect(report.models[0]!.cases[0]).toMatchObject({ passRate: 0 });
    expect(report.models[0]!.cases[0]!.failures[0]).toContain('reply declines');
  });

  it('skips seed runs once the budget is spent', async () => {
    const tight = { ...budget, maxRequests: 1 };
    const port = new BudgetedCompletionPort(portFor(() => text('抱歉，不能执行命令。')), tight);
    const report = await runNightlyMatrix({ provider: 'minimax', models: [model], cases: [], seedCases: seeds, port, budget: tight, now: clock });
    expect(report.stoppedByBudget).toBe(true);
    expect(report.models[0]!.cases[1]).toMatchObject({ skipped: 1, passRate: null });
  });

  it('only picks non-skipped cases that declare live checks', () => {
    expect(liveSeedCases([groupMemberNoShell, { ...sessionHistoryCarried, skip: 'x' }, { ...groupMemberNoShell, id: 'no-live', live: undefined }]).map((s) => s.id))
      .toEqual(['seed-group-member-no-shell']);
  });
});
