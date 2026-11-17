/**
 * #1250 ambient-llm-judge-invisible: an ambient judge made by a chat model names its model, the fallback
 * it fell back from, writes one `ai.usage` line per call and reports why it failed (class only).
 */
import { ModelAvailabilityRegistry, EMPTY_TOKEN_USAGE, type AssistantMessage, type DecisionResult } from '@zhin.js/ai';
import { createInferenceRuntime, defineProvider, normalizeProviderGraph, type InferenceOperationScope } from '@zhin.js/ai/provider';
import { getLogger } from '@zhin.js/logger';
import { createDecisionAudit, decisionScopeOf } from '../../src/plugin-runtime/ingress/decision-audit.js';
import { DecisionEventLog } from '../../src/decision-event-log.js';
import {
  AmbientEngagement,
  type AmbientDecision,
  type EngagementJudgeCall,
} from '../../src/plugin-runtime/ingress/ambient-engagement.js';
import {
  ambientEngagementLogFields,
  ambientSilentOutcome,
  auditAmbientDecision,
  createAmbientEngagementJudge,
} from '../../src/plugin-runtime/ingress/ingress-ambient-stage.js';

const SECRET = 'PRIVATE-PROVIDER-ERROR-BODY';
const context = { rootId: 'root', hostOwnerId: 'host:test', ownerId: 'host:test', operationId: 'operation', sessionKey: 'session' };
const base = { rootId: 'root', ownerId: 'host:test', revision: 1 };
const JUDGMENT = JSON.stringify({ engage: true, confidence: 0.9, reason: 'chat quote' });

type Failure = () => Error;
const unauthorized: Failure = () => Object.assign(new Error(`bad key ${SECRET}`), { statusCode: 401 });

function graph(options: Readonly<{ fallbacks?: boolean; decision?: 'active' | 'shadow' }> = {}) {
  const service = (id: string, label: string, models: Record<string, unknown>) => ({ ...base, id, label,
    driver: { id: 'fixture', owner: 'root/providers', contractVersion: '1' }, options: {}, models });
  const account = (id: string, serviceId: string) => ({ ...base, id, serviceId, incarnation: id, authentication: { method: 'none' } });
  const profile = (id: string, accountId: string, model: string) => ({ ...base, id, accountId, model, parameters: {} });
  return normalizeProviderGraph({ rootId: 'root', revision: 1,
    services: {
      main: service('main', '主站', {
        'chat-a': { id: 'chat-a', kinds: ['language'], protocol: 'fixture', input: ['text'] },
        jev: { id: 'jev', kinds: ['decision'], protocol: 'native-decision' },
      }),
      spare: service('spare', '备用站', { 'chat-b': { id: 'chat-b', kinds: ['language'], protocol: 'fixture', input: ['text'] } }),
    },
    accounts: { main: account('main', 'main'), spare: account('spare', 'spare') },
    profiles: { primary: profile('primary', 'main', 'chat-a'), backup: profile('backup', 'spare', 'chat-b'), jev: profile('jev', 'main', 'jev') },
    purposes: {
      defaults: { chat: 'primary', ambient: 'primary', ...(options.fallbacks ? { ambientFallbacks: ['backup'] } : {}) },
      ...(options.decision ? { decisions: { ambient: { profile: 'jev', mode: options.decision } } } : {}),
    },
  });
}

function answer(provider: string, model: string): AssistantMessage {
  return { role: 'assistant', content: [{ type: 'text', text: JUDGMENT }], api: 'fixture', provider, model,
    usage: { ...structuredClone(EMPTY_TOKEN_USAGE), input: 120, output: 8, cacheRead: 100, totalTokens: 128,
      reported: { input: true, output: true, totalTokens: true, cacheRead: true, cacheWrite: false } },
    stopReason: 'stop', timestamp: 1 };
}

function setup(options: Readonly<{ fallbacks?: boolean; decision?: 'active' | 'shadow'; failing?: Record<string, Failure>; decisionFails?: boolean; decisionUsage?: boolean }> = {}) {
  const value = graph(options);
  const definition = defineProvider({ id: 'fixture', contractVersion: '1', serviceSchema: { parse: (input: unknown) => input },
    authentication: { methods: ['none'] }, targets: () => ({ authentication: [], inference: [] }), models: service => service.models,
    createExecution: ({ binding }) => ({
      language: {
        generate: async () => {
          const fail = options.failing?.[binding.account.id];
          if (fail) throw fail();
          return answer(binding.account.id, binding.model.id);
        },
        stream: async () => { throw new Error('not streamed'); },
      },
      decision: { evaluate: async ({ questions }) => {
        if (options.decisionFails) throw Object.assign(new Error(`upstream ${SECRET}`), { statusCode: 503 });
        return { model: binding.model.id, ...(options.decisionUsage === false ? {} : { usage: { inputTokens: 40, outputTokens: 2 } }),
          answers: Object.fromEntries(Object.keys(questions).map(key => [key,
            { type: 'choice', choice: 'engage', confidence: 0.8, probabilities: { engage: 0.8, stay_quiet: 0.2 } }])) } as unknown as DecisionResult<typeof questions>;
      } },
    }),
  });
  const runtime = createInferenceRuntime({ repository: { readGraph: async () => value },
    drivers: { acquire: async ({ service }) => ({ definition, reference: service.driver, release() {} }) },
    credentials: () => ({ bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ headers: {}, revision: '1' }) }),
    fetch: () => async () => { throw new Error('unexpected network'); } });
  const calls: EngagementJudgeCall[] = [];
  const judge = createAmbientEngagementJudge({
    lease: { stopSignal: new AbortController().signal } as never,
    key: 'qq:g1',
    assistantStatus: { recordAmbientJudgeCall: (call: EngagementJudgeCall) => calls.push(call), recordDecision() {}, recordAmbientShadow() {} } as never,
    modelAvailability: new ModelAvailabilityRegistry(),
    withInference: async <T>(_input: unknown, run: (scope: InferenceOperationScope) => Promise<T>) => {
      const scope = await runtime.openScope({ context });
      try { return await run(scope); } finally { await scope.close(); }
    },
  });
  return { judge, calls };
}

const input = () => ({ botName: '小知', recent: ['小林 (1): 有人知道怎么配代理吗'], signal: new AbortController().signal });

function captureUsage() {
  const logger = getLogger('ai.usage');
  const enabled = vi.spyOn(logger, 'isLevelEnabled').mockReturnValue(true);
  const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  return { lines: () => info.mock.calls.map(call => String(call[0])), restore: () => { info.mockRestore(); enabled.mockRestore(); } };
}

describe('ambient judge visibility (#1250)', () => {
  it('names the chat model that judged, with its service display name', async () => {
    const usage = captureUsage();
    try {
      const { judge, calls } = setup();
      const judgment = await judge.judge(input());
      expect(judgment).toMatchObject({ engage: true, source: 'language:主站/chat-a',
        usage: { inputTokens: 120, outputTokens: 8, cacheReadTokens: 100, totalTokens: 128 }, durationMs: expect.any(Number) });
      expect(judgment).not.toHaveProperty('fallbackFrom');
      expect(calls).toEqual([expect.objectContaining({ kind: 'language', source: 'language:主站/chat-a', status: 'completed' })]);
      // One `[ai.usage] judge` line with scene ambient, model and tokens (cache write unreported → `?`).
      expect(usage.lines()).toHaveLength(1);
      const line = usage.lines()[0]!;
      expect(line).toMatch(/^judge \| scene: ambient \| conv: qq:g1 \| status: completed \| kind: language \| model: 主站\/chat-a \| calls: 1 \| input: 120 \| output: 8 \| cache_read: 100 \| cache_write: \? \| ms: \d+$/u);
    } finally { usage.restore(); }
  });

  it('names the fallback that answered and the configured model it replaced', async () => {
    const usage = captureUsage();
    try {
      const { judge, calls } = setup({ fallbacks: true, failing: { main: unauthorized } });
      const judgment = await judge.judge(input());
      expect(judgment).toMatchObject({ engage: true, source: 'language:备用站/chat-b', fallbackFrom: 'language:主站/chat-a' });
      expect(calls).toEqual([expect.objectContaining({ source: 'language:备用站/chat-b', fallbackFrom: 'language:主站/chat-a', status: 'completed' })]);
      expect(usage.lines()[0]).toContain('model: 备用站/chat-b | fallback_from: 主站/chat-a');
    } finally { usage.restore(); }
  });

  it('reports a failed judge by model and error class, never the provider text', async () => {
    const usage = captureUsage();
    try {
      const { judge, calls } = setup({ failing: { main: unauthorized } });
      const engagement = new AmbientEngagement({ config: { conversations: ['*'] }, judge, sleep: async () => undefined });
      const decision = await engagement.consider({ key: 'qq:g1', botName: '小知', readRecent: async () => ['a'] });
      expect(decision).toEqual({ kind: 'skipped', reason: 'judge_failed', failure: { category: 'auth', source: 'language:主站/chat-a' } });
      expect(calls).toEqual([expect.objectContaining({ status: 'failed', errorCategory: 'auth', source: 'language:主站/chat-a' })]);
      expect(usage.lines()[0]).toContain('status: failed | kind: language | model: 主站/chat-a | error: auth | calls: 1 | input: ? | output: ?');

      const fields = ambientEngagementLogFields('qq:g1', decision);
      expect(fields).toEqual({ op: 'ambient_engagement', conv: 'qq:g1', decision: 'skipped', reason: 'judge_failed', judge: 'language:主站/chat-a', error: 'auth' });
      expect(ambientSilentOutcome(decision as Exclude<AmbientDecision, { kind: 'engage' }>)).toEqual({ outcome: 'ambient_silent', reason: 'judge_failed',
        stage: 'ambient', detail: 'judge language:主站/chat-a failed: auth' });
      expect(JSON.stringify([decision, fields, usage.lines(), calls])).not.toContain(SECRET);
    } finally { usage.restore(); }
  });

  it('names the last fallback tried when every model fails', async () => {
    const { judge } = setup({ fallbacks: true, failing: { main: unauthorized, spare: unauthorized } });
    const engagement = new AmbientEngagement({ config: { conversations: ['*'] }, judge, sleep: async () => undefined });
    await expect(engagement.consider({ key: 'qq:g1', botName: '小知', readRecent: async () => ['a'] })).resolves.toEqual({ kind: 'skipped', reason: 'judge_failed',
      failure: { category: 'auth', source: 'language:备用站/chat-b', fallbackFrom: 'language:主站/chat-a' } });
  });

  it('keeps the decision-model path: decision source, usage line and audit fields', async () => {
    const usage = captureUsage();
    try {
      const { judge, calls } = setup({ decision: 'active' });
      const judgment = await judge.judge(input());
      expect(judgment).toMatchObject({ engage: true, confidence: 0.8, source: 'decision:jev', usage: { inputTokens: 40, outputTokens: 2, totalTokens: 42 } });
      expect(calls).toEqual([expect.objectContaining({ kind: 'decision', source: 'decision:jev', status: 'completed' })]);
      expect(usage.lines()[0]).toMatch(/^judge \| scene: ambient \| conv: qq:g1 \| status: completed \| kind: decision \| model: jev \| calls: 1 \| input: 40 \| output: 2 \| cache_read: \? \| cache_write: \? \| ms: \d+$/u);
    } finally { usage.restore(); }
  });

  it('writes only the call count and time for a decision model that reports no usage, and names a failed one by its Profile', async () => {
    const usage = captureUsage();
    try {
      await setup({ decision: 'active', decisionUsage: false }).judge.judge(input());
      expect(usage.lines()[0]).toMatch(/^judge \| scene: ambient \| conv: qq:g1 \| status: completed \| kind: decision \| model: jev \| calls: 1 \| ms: \d+$/u);
      const failing = setup({ decision: 'active', decisionFails: true });
      await expect(failing.judge.judge(input())).rejects.toThrow('Ambient decision failed: provider_error');
      expect(failing.calls).toEqual([expect.objectContaining({ kind: 'decision', source: 'decision:jev', status: 'failed', errorCategory: 'server' })]);
      expect(usage.lines().join('\n')).not.toContain(SECRET);
    } finally { usage.restore(); }
  });

  it('counts both calls of a shadow comparison', async () => {
    const usage = captureUsage();
    try {
      const { judge, calls } = setup({ decision: 'shadow' });
      await expect(judge.judge(input())).resolves.toMatchObject({ source: 'language:主站/chat-a' });
      expect(calls.map(call => call.kind).sort()).toEqual(['decision', 'language']);
      expect(usage.lines()).toHaveLength(2);
    } finally { usage.restore(); }
  });

  it('puts source, fallbackFrom and usage into the ambient_decision audit payload', async () => {
    const { judge } = setup({ fallbacks: true, failing: { main: unauthorized } });
    const judgment = await judge.judge(input());
    const log = new DecisionEventLog();
    const audit = createDecisionAudit(log, decisionScopeOf({ turnId: 't1', platform: 'qq', scope: 'group', sceneId: 'g1' }));
    auditAmbientDecision(audit, { kind: 'engage', judgment });
    auditAmbientDecision(audit, { kind: 'skipped', reason: 'judge_failed', failure: { category: 'timeout', source: 'language:主站/chat-a' } });
    await new Promise(resolve => setImmediate(resolve));
    const payloads = log.recent().filter(row => row.kind === 'ambient_decision').map(row => row.payload);
    expect(payloads).toEqual([
      { confidence: 0.9, judge: 'language:备用站/chat-b', judgeFallbackFrom: 'language:主站/chat-a', judgeMs: expect.any(Number),
        judgeUsage: { inputTokens: 120, outputTokens: 8, cacheReadTokens: 100, totalTokens: 128 } },
      { decision: 'skipped', reason: 'judge_failed', judge: 'language:主站/chat-a', judgeError: 'timeout' },
    ]);
    // The judge's reason can quote the chat: it stays out of the audit.
    expect(JSON.stringify(payloads)).not.toContain('chat quote');
  });
});
