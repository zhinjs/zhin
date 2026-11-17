import {
  AUTH_FALLBACK_COOLDOWN_MS, CONSECUTIVE_TIMEOUTS_TO_SWITCH, MODEL_FALLBACK_NOTICE, TIMEOUT_FALLBACK_COOLDOWN_MS,
  TIMEOUT_GLOBAL_OPERATIONS, TIMEOUT_GLOBAL_WINDOW_MS, fallbackTranscriptFit, ModelAvailabilityRegistry, QUOTA_FALLBACK_COOLDOWN_MS,
  createFallbackCompletionPort, modelFallbackFailure, modelFallbackResetAt, nextPacificMidnight,
  type ModelFallbackEvent,
} from '../../src/llm/model-fallback.js';
import { ProviderRequestError, classifyProviderError, createResilientCompletionPort } from '../../src/llm/provider-resilience.js';
import { EMPTY_TOKEN_USAGE, type AssistantMessage } from '../../src/llm/types/agent-message.js';
import type { LlmCompletionPort } from '../../src/llm/llm-api-runtime.js';
import type { Model } from '../../src/llm/types/model.js';
import type { Context } from '../../src/llm/types/context.js';
import { agentLoop } from '../../src/llm/agent-loop.js';
import { agentContextFrom, createUserMessage, z, type LlmTool } from '../../src/llm/index.js';

/** #1250 chat-purpose-no-fallback. */
const geminiDaily = Object.assign(new Error('quota'), {
  statusCode: 429,
  responseBody: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' },
  ] } }),
});
const billing = Object.assign(new Error('Insufficient balance'), { statusCode: 402 });
const unauthorized = Object.assign(new Error('bad key'), { statusCode: 401 });
const serverError = Object.assign(new Error('boom'), { statusCode: 503 });
const rateLimited = Object.assign(new Error('slow down'), { statusCode: 429 });

function model(id: string, provider: string): Model {
  return { id, name: id, provider, api: 'provider', input: ['text'], contextWindow: 1000, maxTokens: 100 } as Model;
}
function reply(text: string, from: string): AssistantMessage {
  return { role: 'assistant', content: [{ type: 'text', text }], api: 'provider', provider: from, model: from,
    usage: structuredClone(EMPTY_TOKEN_USAGE), stopReason: 'stop', timestamp: 1 };
}
const context: Context = { messages: [] } as unknown as Context;

/** A port that fails with the queued errors (one per call), then answers. */
function port(name: string, failures: unknown[] = []) {
  const calls: Model[] = [];
  const completion: LlmCompletionPort = {
    complete: async (selected, _context, options) => {
      calls.push(selected);
      const failure = failures.shift();
      if (failure) throw failure;
      options?.onTextDelta?.(`${name} says hi`);
      return reply(`${name} answer`, name);
    },
    completeSimple: async selected => { calls.push(selected); return reply(`${name} answer`, name); },
  };
  return { completion, calls };
}

function setup(primaryFailures: unknown[], fallbackFailures: unknown[] = [], registry = new ModelAvailabilityRegistry({ now: () => 1_000 })) {
  const primary = port('gemini', primaryFailures);
  const fallback = port('cnb', fallbackFailures);
  const last = port('deepseek');
  const events: ModelFallbackEvent[] = [];
  const primaryModel = model('gemini-flash', 'gemini-account');
  const completion = createFallbackCompletionPort({
    purpose: 'chat', registry, onFallback: event => events.push(event),
    primary: { endpoint: { profileId: 'free', accountId: 'gemini-account', model: 'gemini-flash' }, model: primaryModel, completion: primary.completion },
    fallbacks: [
      { endpoint: { profileId: 'cnb', accountId: 'cnb-account', model: 'cnb-model' },
        resolve: async () => ({ model: model('cnb-model', 'cnb-account'), completion: fallback.completion }) },
      { endpoint: { profileId: 'deep', accountId: 'deepseek-account', model: 'deepseek-chat' },
        resolve: async () => ({ model: model('deepseek-chat', 'deepseek-account'), completion: last.completion }) },
    ],
  });
  return { completion, primary, fallback, last, events, registry, primaryModel };
}

describe('purpose model fallback (#1250 chat-purpose-no-fallback)', () => {
  it('answers from the next fallback when the primary quota is exhausted', async () => {
    const { completion, fallback, events, registry, primaryModel } = setup([geminiDaily]);
    const answer = await completion.complete(primaryModel, context);
    expect(answer.provider).toBe('cnb');
    expect(fallback.calls[0]!.id).toBe('cnb-model');
    expect(events).toEqual([expect.objectContaining({ purpose: 'chat', reason: 'quota_exhausted', phase: 'request',
      from: expect.objectContaining({ profileId: 'free' }), to: expect.objectContaining({ profileId: 'cnb' }), notice: MODEL_FALLBACK_NOTICE })]);
    expect(registry.unavailable('gemini-account', 'gemini-flash')?.until).toBe(nextPacificMidnight(1_000));
    expect(registry.recentFallbacks()).toHaveLength(1);
  });

  it('switches for billing and auth, walking the chain in order', async () => {
    const { completion, last, events, primaryModel } = setup([billing], [unauthorized]);
    expect((await completion.complete(primaryModel, context)).provider).toBe('deepseek');
    expect(last.calls).toHaveLength(1);
    expect(events.map(event => [event.reason, event.to.profileId])).toEqual([['billing', 'cnb'], ['auth', 'deep']]);
  });

  it('stays on the fallback for later requests of the same operation', async () => {
    const { completion, primary, fallback, primaryModel } = setup([geminiDaily]);
    await completion.complete(primaryModel, context);
    await completion.complete(primaryModel, context);
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(2);
  });

  it.each([['rate limit', rateLimited], ['plain', new Error('weird')]])('never switches on a %s error', async (_name, error) => {
    const { completion, fallback, events, registry, primaryModel } = setup([error]);
    await expect(completion.complete(primaryModel, context)).rejects.toBe(error);
    expect(fallback.calls).toHaveLength(0);
    expect(events).toEqual([]);
    expect(registry.list()).toEqual([]);
  });

  it('does not switch on a server error the same model will be asked again (#1250 b40)', async () => {
    const { completion, fallback, events, registry, primaryModel } = setup([serverError]);
    await expect(completion.complete(primaryModel, context, { willRetry: () => true })).rejects.toBe(serverError);
    expect(fallback.calls).toHaveLength(0);
    expect(events).toEqual([]);
    expect(registry.list()).toEqual([]);
  });

  it('does not switch once text reached the user or the caller forbids another attempt', async () => {
    const streamed = setup([]);
    const failing: LlmCompletionPort = { complete: async (_m, _c, options) => { options?.onTextDelta?.('partial'); throw geminiDaily; },
      completeSimple: async () => { throw geminiDaily; } };
    const registry = new ModelAvailabilityRegistry({ now: () => 0 });
    const afterText = createFallbackCompletionPort({ purpose: 'chat', registry,
      primary: { endpoint: { profileId: 'free', accountId: 'a', model: 'm' }, model: streamed.primaryModel, completion: failing },
      fallbacks: [{ endpoint: { profileId: 'cnb', accountId: 'b', model: 'n' }, resolve: async () => ({ model: model('n', 'b'), completion: streamed.fallback.completion }) }] });
    await expect(afterText.complete(streamed.primaryModel, context, { onTextDelta: () => undefined })).rejects.toBe(geminiDaily);
    expect(streamed.fallback.calls).toHaveLength(0);
    // The exhausted model is still remembered for the next operation.
    expect(registry.unavailable('a', 'm')?.reason).toBe('quota_exhausted');

    const forbidden = setup([geminiDaily]);
    await expect(forbidden.completion.complete(forbidden.primaryModel, context, { retryAllowed: () => false })).rejects.toBe(geminiDaily);
    expect(forbidden.fallback.calls).toHaveLength(0);
  });

  it('skips an exhausted fallback until its reset time', async () => {
    let now = 1_000;
    const registry = new ModelAvailabilityRegistry({ now: () => now });
    registry.markUnavailable({ accountId: 'cnb-account', model: 'cnb-model', reason: 'quota_exhausted', until: 5_000 });
    const first = setup([geminiDaily], [], registry);
    expect((await first.completion.complete(first.primaryModel, context)).provider).toBe('deepseek');
    expect(first.fallback.calls).toHaveLength(0);
    now = 5_000;
    expect(registry.unavailable('cnb-account', 'cnb-model')).toBeUndefined();
    const second = setup([unauthorized], [], registry);
    expect((await second.completion.complete(second.primaryModel, context)).provider).toBe('cnb');
  });

  it('rethrows the last error when no fallback is left', async () => {
    const exhausted = setup([geminiDaily], [billing], new ModelAvailabilityRegistry({ now: () => 0 }));
    exhausted.registry.markUnavailable({ accountId: 'deepseek-account', model: 'deepseek-chat', reason: 'billing', until: 10 });
    // The fallback ran under its own resilience policy, which reports its failure.
    await expect(exhausted.completion.complete(exhausted.primaryModel, context)).rejects.toMatchObject({ kind: 'billing' });
    expect(exhausted.last.calls).toHaveLength(0);
  });

  it('sits below provider-resilience: quota switches without a retry, the final failure keeps its message', async () => {
    const { completion, primaryModel, fallback } = setup([geminiDaily]);
    const resilient = createResilientCompletionPort(completion, { sleep: async () => undefined });
    expect((await resilient.complete(primaryModel, context)).provider).toBe('cnb');
    expect(fallback.calls).toHaveLength(1);
    const lone = setup([geminiDaily], [geminiDaily], new ModelAvailabilityRegistry({ now: () => 0 }));
    lone.registry.markUnavailable({ accountId: 'deepseek-account', model: 'deepseek-chat', reason: 'billing', until: 10 });
    await expect(createResilientCompletionPort(lone.completion, { sleep: async () => undefined }).complete(lone.primaryModel, context))
      .rejects.toBeInstanceOf(ProviderRequestError);
  });
});

describe('fallback inside an agent loop (#1250)', () => {
  it('continues from the transcript on the fallback and never replays executed tools', async () => {
    const tool: LlmTool = { name: 'send_mail', description: 'side effect', parameters: z.object({ to: z.string() }) };
    let primaryCalls = 0;
    const primaryModel = model('gemini-flash', 'gemini-account');
    const primary: LlmCompletionPort = {
      complete: async () => {
        primaryCalls++;
        if (primaryCalls > 1) throw geminiDaily;
        return { ...reply('', 'gemini'), content: [{ type: 'toolCall', id: 'call_1', name: 'send_mail', arguments: { to: 'bob' } }],
          stopReason: 'toolCalls' } as AssistantMessage;
      },
      completeSimple: async () => { throw new Error('unused'); },
    };
    const seen: Context[] = [];
    const fallback: LlmCompletionPort = {
      complete: async (_model, received) => { seen.push(received); return reply('mail sent', 'cnb'); },
      completeSimple: async () => { throw new Error('unused'); },
    };
    const transport = createFallbackCompletionPort({ purpose: 'chat', registry: new ModelAvailabilityRegistry({ now: () => 0 }),
      primary: { endpoint: { profileId: 'free', accountId: 'gemini-account', model: 'gemini-flash' }, model: primaryModel, completion: primary },
      fallbacks: [{ endpoint: { profileId: 'cnb', accountId: 'cnb-account', model: 'cnb-model' },
        resolve: async () => ({ model: model('cnb-model', 'cnb-account'), completion: fallback }) }] });
    let executions = 0;
    const events: string[] = [];
    for await (const event of agentLoop(createUserMessage('mail bob'), agentContextFrom({ systemPrompt: 'sys', messages: [], tools: [tool] }), {
      model: primaryModel, transport, maxIterations: 4,
      executeTool: async call => { executions++; return { role: 'toolResult', toolCallId: call.id, toolName: call.name,
        content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 1 }; },
    })) events.push(event.type);
    expect(executions).toBe(1);
    expect(primaryCalls).toBe(2);
    expect(seen).toHaveLength(1);
    // The fallback sees the executed call and its result; it does not run the tool again.
    expect(seen[0]!.messages.map(message => message.role)).toEqual(['user', 'assistant', 'toolResult']);
    expect(events).toContain('agent_end');
  });
});

describe('fallback reset rule (#1250)', () => {
  it('classifies only switchable failures', () => {
    expect(modelFallbackFailure(geminiDaily)).toMatchObject({ kind: 'quota_exhausted', quotaWindow: 'day' });
    expect(modelFallbackFailure(billing)?.kind).toBe('billing');
    expect(modelFallbackFailure(unauthorized)?.kind).toBe('auth');
    expect(modelFallbackFailure(new ProviderRequestError('quota_exhausted', 1, geminiDaily))?.kind).toBe('quota_exhausted');
    expect(modelFallbackFailure(serverError)).toBeUndefined();
    expect(modelFallbackFailure(rateLimited)).toBeUndefined();
  });
  it('uses the next Pacific midnight for daily quotas (DST aware)', () => {
    // 2026-07-01 12:00 UTC = 05:00 PDT → next midnight 2026-07-02 07:00 UTC.
    expect(new Date(nextPacificMidnight(Date.UTC(2026, 6, 1, 12))).toISOString()).toBe('2026-07-02T07:00:00.000Z');
    // 2026-12-01 12:00 UTC = 04:00 PST → 2026-12-02 08:00 UTC.
    expect(new Date(nextPacificMidnight(Date.UTC(2026, 11, 1, 12))).toISOString()).toBe('2026-12-02T08:00:00.000Z');
    // 2026-11-01 (DST ends) 06:00 UTC = 23:00 PDT on Oct 31 → 2026-11-01 07:00 UTC.
    expect(new Date(nextPacificMidnight(Date.UTC(2026, 10, 1, 6))).toISOString()).toBe('2026-11-01T07:00:00.000Z');
  });
  it('prefers a provider reset hint, then fixed cooldowns', () => {
    expect(modelFallbackResetAt({ kind: 'quota_exhausted', retryAfterMs: 90_000 }, 0)).toBe(90_000);
    expect(modelFallbackResetAt({ kind: 'quota_exhausted' }, 0)).toBe(QUOTA_FALLBACK_COOLDOWN_MS);
    expect(modelFallbackResetAt({ kind: 'auth' }, 0)).toBe(AUTH_FALLBACK_COOLDOWN_MS);
    // A daily quota ignores Gemini's short retryDelay but honours a shorter rolling-window hint.
    expect(modelFallbackResetAt({ kind: 'quota_exhausted', quotaWindow: 'day', retryAfterMs: 86_000 }, Date.UTC(2026, 6, 1, 12)))
      .toBe(Date.UTC(2026, 6, 1, 12) + 86_000);
  });
});

describe('review follow-ups (#1250 / #1270)', () => {
  const forbidden = Object.assign(new Error('blocked by gateway policy'), { statusCode: 403 });
  const badKey = Object.assign(new Error('bad key'), { statusCode: 400,
    responseBody: JSON.stringify({ error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }) });
  const timeout = () => Object.assign(new Error('Provider request timed out'), { name: 'TimeoutError' });

  function chain(primaryPort: LlmCompletionPort, fallbacks: Array<{ id: string; model: Model; port: LlmCompletionPort }>, registry = new ModelAvailabilityRegistry()) {
    const primaryModel = model('gemini-flash', 'gemini-account');
    const events: ModelFallbackEvent[] = [];
    const completion = createFallbackCompletionPort({ purpose: 'chat', registry, onFallback: event => events.push(event),
      primary: { endpoint: { profileId: 'free', accountId: 'gemini-account', model: 'gemini-flash' }, model: primaryModel, completion: primaryPort },
      fallbacks: fallbacks.map(entry => ({ endpoint: { profileId: entry.id, accountId: `${entry.id}-account`, model: entry.model.id },
        resolve: async () => ({ model: entry.model, completion: entry.port }) })) });
    return { completion, primaryModel, events, registry };
  }
  function recording(name: string) {
    const calls: Array<{ model: Model; context: Context; options?: Parameters<LlmCompletionPort['complete']>[2] }> = [];
    const port: LlmCompletionPort = {
      complete: async (selected, received, options) => { calls.push({ model: selected, context: received, options }); return reply(`${name} answer`, name); },
      completeSimple: async () => reply('unused', name),
    };
    return { port, calls };
  }
  const failing = (...errors: unknown[]): LlmCompletionPort => ({
    complete: async () => { const next = errors.shift(); if (next) throw next; return reply('primary answer', 'gemini'); },
    completeSimple: async () => reply('unused', 'gemini'),
  });

  it('switches on a rejected credential but not on a plain 403', async () => {
    const plain = recording('cnb');
    const blocked = chain(failing(forbidden), [{ id: 'cnb', model: model('cnb-model', 'cnb-account'), port: plain.port }]);
    await expect(blocked.completion.complete(blocked.primaryModel, context)).rejects.toBe(forbidden);
    expect(plain.calls).toHaveLength(0);
    expect(blocked.registry.list()).toEqual([]);
    expect(modelFallbackFailure(forbidden)).toBeUndefined();

    for (const error of [unauthorized, badKey]) {
      const target = recording('cnb');
      const keyed = chain(failing(error), [{ id: 'cnb', model: model('cnb-model', 'cnb-account'), port: target.port }]);
      expect((await keyed.completion.complete(keyed.primaryModel, context)).provider).toBe('cnb');
      expect(keyed.registry.unavailable('gemini-account', 'gemini-flash')?.reason).toBe('auth');
    }
  });

  it('skips fallbacks that cannot take the media or the context, and uses the fallback limits', async () => {
    const textOnly = recording('text-only');
    const small = recording('small');
    const vision = recording('vision');
    const withImage = { systemPrompt: 'sys', messages: [{ role: 'user', content: [{ type: 'text', text: 'what is this '.repeat(400) },
      { type: 'image', data: { media: { kind: 'url', url: 'https://example.test/a.png' } } }], timestamp: 1 }] } as unknown as Context;
    const visionModel = { ...model('vision-model', 'vision-account'), input: ['text', 'image'], contextWindow: 100_000, maxTokens: 512,
      executionPolicy: { maxRetries: 1 } } as Model;
    const { completion, primaryModel, events } = chain(failing(geminiDaily), [
      { id: 'text-only', model: { ...model('text-model', 'text-account'), contextWindow: 100_000 }, port: textOnly.port },
      { id: 'small', model: { ...model('small-model', 'small-account'), input: ['text', 'image'], contextWindow: 100 }, port: small.port },
      { id: 'vision', model: visionModel, port: vision.port },
    ]);
    const answer = await completion.complete(primaryModel, withImage, { maxTokens: 4_096 });
    expect(answer.provider).toBe('vision');
    expect(textOnly.calls).toHaveLength(0);
    expect(small.calls).toHaveLength(0);
    expect(vision.calls[0]!.model).toBe(visionModel);
    expect(vision.calls[0]!.options?.maxTokens).toBe(512);
    expect(events.map(event => event.to.profileId)).toEqual(['vision']);
  });

  it('runs a switched request under the fallback’s own retry policy', async () => {
    let attempts = 0;
    const flaky: LlmCompletionPort = {
      complete: async () => { attempts++; if (attempts === 1) throw serverError; return reply('retried', 'cnb'); },
      completeSimple: async () => reply('unused', 'cnb'),
    };
    const { completion, primaryModel } = chain(failing(geminiDaily), [{ id: 'cnb',
      model: { ...model('cnb-model', 'cnb-account'), executionPolicy: { maxRetries: 1 } }, port: flaky }]);
    expect((await completion.complete(primaryModel, context)).content).toEqual([{ type: 'text', text: 'retried' }]);
    expect(attempts).toBe(2);
  });

  it('re-checks the context window on every request after a switch', async () => {
    const roomy = recording('roomy');
    const small = recording('small');
    const smallModel = { ...model('small-model', 'small-account'), contextWindow: 200 } as Model;
    const roomyModel = { ...model('roomy-model', 'roomy-account'), contextWindow: 100_000 } as Model;
    const { completion, primaryModel, events } = chain(failing(geminiDaily), [
      { id: 'small', model: smallModel, port: small.port },
      { id: 'roomy', model: roomyModel, port: roomy.port },
    ]);
    const short = { systemPrompt: 'sys', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 }] } as unknown as Context;
    expect((await completion.complete(primaryModel, short)).provider).toBe('small');
    const long = { ...short, messages: [{ role: 'user', content: [{ type: 'text', text: 'word '.repeat(2_000) }], timestamp: 1 }] } as unknown as Context;
    expect((await completion.complete(primaryModel, long)).provider).toBe('roomy');
    expect(small.calls).toHaveLength(1);
    expect(events.map(event => [event.reason, event.to.profileId])).toEqual([['quota_exhausted', 'small'], ['context_overflow', 'roomy']]);
    // Past the last fitting fallback: a clear context_overflow, never a request that would 400.
    const huge = { ...short, messages: [{ role: 'user', content: [{ type: 'text', text: 'word '.repeat(200_000) }], timestamp: 1 }] } as unknown as Context;
    const failure = await completion.complete(primaryModel, huge).catch(error => error);
    expect(classifyProviderError(failure).kind).toBe('context_overflow');
    expect(roomy.calls).toHaveLength(1);
  });

  describe('mid tool-loop switch to a strict provider', () => {
    const toolLoop = (call: Record<string, unknown>) => ({ systemPrompt: 'sys', messages: [
      { role: 'user', content: [{ type: 'text', text: 'look it up' }], timestamp: 1 },
      { ...reply('', 'gemini-account'), model: 'gemini-flash', content: [
        { type: 'thinking', thinking: 'plan', providerOptions: { google: { thoughtSignature: 'sig' } } },
        { type: 'toolCall', name: 'search', arguments: {}, ...call }], stopReason: 'toolCalls' },
      { role: 'toolResult', toolCallId: String(call.id), toolName: 'search', content: [{ type: 'text', text: 'found' }], isError: false, timestamp: 2 },
    ] }) as unknown as Context;

    it('Gemini → Anthropic with thinking: sends the request without thinking instead of failing', async () => {
      const anthropic = recording('anthropic');
      const anthropicModel = { ...model('claude-model', 'anthropic-account'), promptFamily: 'anthropic', reasoning: true } as Model;
      const transcript = toolLoop({ id: 'call_abc', providerOptions: { google: { thoughtSignature: 'sig' } } });
      expect(fallbackTranscriptFit(anthropicModel, transcript)).toBe('no-thinking');
      const { completion, primaryModel, events } = chain(failing(geminiDaily), [{ id: 'anthropic', model: anthropicModel, port: anthropic.port }]);
      expect((await completion.complete(primaryModel, transcript, { thinkingLevel: 'high' })).provider).toBe('anthropic');
      expect(anthropic.calls[0]!.options?.thinkingLevel).toBe('off');
      // The executed tool call is sent as history, not run again.
      expect(anthropic.calls[0]!.context.messages.map(message => message.role)).toEqual(['user', 'assistant', 'toolResult']);
      expect(events).toHaveLength(1);
    });

    it('skips Gemini without thought signatures and Mistral with foreign tool ids', async () => {
      const unsigned = toolLoop({ id: 'call_abc' });
      const gemini = recording('gemini3');
      const mistral = recording('mistral');
      const last = recording('deepseek');
      const geminiModel = { ...model('gemini-3-pro', 'g3-account'), promptFamily: 'google' } as Model;
      const mistralModel = { ...model('mistral-large-latest', 'mistral-account'), promptFamily: 'openai-compatible' } as Model;
      expect(fallbackTranscriptFit(geminiModel, unsigned)).toBe('skip');
      expect(fallbackTranscriptFit(mistralModel, unsigned)).toBe('skip');
      expect(fallbackTranscriptFit(mistralModel, toolLoop({ id: 'abcDEF123' }))).toBe('ok');
      const { completion, primaryModel } = chain(failing(geminiDaily), [
        { id: 'gemini3', model: geminiModel, port: gemini.port },
        { id: 'mistral', model: mistralModel, port: mistral.port },
        { id: 'deepseek', model: model('deepseek-chat', 'deepseek-account'), port: last.port },
      ]);
      expect((await completion.complete(primaryModel, unsigned)).provider).toBe('deepseek');
      expect(gemini.calls).toHaveLength(0);
      expect(mistral.calls).toHaveLength(0);
    });
  });

  describe('consecutive timeouts (#1270)', () => {
    it('a one-off timeout behaves as before: no switch, no skip', async () => {
      const target = recording('cnb');
      const { completion, primaryModel, registry } = chain(failing(timeout()), [{ id: 'cnb', model: model('cnb-model', 'cnb-account'), port: target.port }]);
      await expect(completion.complete(primaryModel, context)).rejects.toMatchObject({ name: 'TimeoutError' });
      expect((await completion.complete(primaryModel, context)).provider).toBe('gemini');
      expect(target.calls).toHaveLength(0);
      expect(registry.list()).toEqual([]);
    });

    it(`switches after ${CONSECUTIVE_TIMEOUTS_TO_SWITCH} consecutive timeouts within the operation only`, async () => {
      const target = recording('cnb');
      const registry = new ModelAvailabilityRegistry({ now: () => 0 });
      const { completion, primaryModel, events } = chain(failing(timeout(), timeout()), [{ id: 'cnb', model: model('cnb-model', 'cnb-account'), port: target.port }], registry);
      await expect(completion.complete(primaryModel, context)).rejects.toMatchObject({ name: 'TimeoutError' });
      expect((await completion.complete(primaryModel, context)).provider).toBe('cnb');
      expect(events[0]).toMatchObject({ reason: 'timeout', phase: 'request' });
      expect(events[0]!.fromUntil).toBeUndefined();
      // One operation (one user's huge prompt) never skips the model for everyone.
      expect(registry.unavailable('gemini-account', 'gemini-flash')).toBeUndefined();
    });

    it(`skips globally once ${TIMEOUT_GLOBAL_OPERATIONS} distinct operations time out within the window`, async () => {
      let now = 0;
      const registry = new ModelAvailabilityRegistry({ now: () => now });
      const operation = () => chain(failing(timeout(), timeout()), [{ id: 'cnb', model: model('cnb-model', 'cnb-account'), port: recording('cnb').port }], registry);
      const run = async (op: ReturnType<typeof operation>) => {
        await op.completion.complete(op.primaryModel, context).catch(() => undefined);
        return op.completion.complete(op.primaryModel, context);
      };
      await run(operation());
      expect(registry.unavailable('gemini-account', 'gemini-flash')).toBeUndefined();
      // A second operation, but outside the window: still nothing global.
      now = TIMEOUT_GLOBAL_WINDOW_MS + 1;
      await run(operation());
      expect(registry.unavailable('gemini-account', 'gemini-flash')).toBeUndefined();
      now += 30_000;
      const third = operation();
      await run(third);
      expect(registry.unavailable('gemini-account', 'gemini-flash')).toMatchObject({ reason: 'timeout', until: now + TIMEOUT_FALLBACK_COOLDOWN_MS });
    });

    it('does not count a caller-supplied AbortSignal.timeout', async () => {
      const target = recording('cnb');
      const registry = new ModelAvailabilityRegistry();
      const aborting: LlmCompletionPort = {
        complete: (_m, _c, options) => new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
        }),
        completeSimple: async () => reply('unused', 'gemini'),
      };
      const { completion, primaryModel, events } = chain(aborting, [{ id: 'cnb', model: model('cnb-model', 'cnb-account'), port: target.port }], registry);
      for (let i = 0; i < 3; i++) {
        await expect(completion.complete(primaryModel, context, { signal: AbortSignal.timeout(5) })).rejects.toMatchObject({ name: 'TimeoutError' });
      }
      expect(target.calls).toHaveLength(0);
      expect(events).toEqual([]);
      expect(registry.list()).toEqual([]);
    });

    it('composes with the resilience per-attempt timer: the attempt after the second timeout goes to the fallback', async () => {
      const target = recording('cnb');
      let primaryCalls = 0;
      const hanging: LlmCompletionPort = {
        complete: (_m, _c, options) => { primaryCalls++; return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
        }); },
        completeSimple: async () => reply('unused', 'gemini'),
      };
      const { completion, primaryModel } = chain(hanging, [{ id: 'cnb', model: model('cnb-model', 'cnb-account'), port: target.port }]);
      const resilient = createResilientCompletionPort(completion, { config: { requestTimeoutMs: 20, maxRetries: 2 }, sleep: async () => undefined });
      expect((await resilient.complete(primaryModel, context)).provider).toBe('cnb');
      expect(primaryCalls).toBe(2);
    });

    describe('first-response deadline (no_response) counts as a timeout', () => {
      /** Hangs (no response headers, no stream event) for the first `hangs` calls, then answers. */
      function silentThenAnswer(hangs: number) {
        let calls = 0;
        const port: LlmCompletionPort = {
          complete: (_m, _c, options) => {
            calls++;
            if (calls > hangs) return Promise.resolve(reply('primary answer', 'gemini'));
            return new Promise((_resolve, reject) => {
              options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
            });
          },
          completeSimple: async () => reply('unused', 'gemini'),
        };
        return { port, calls: () => calls };
      }
      const resilientOver = (completion: LlmCompletionPort) => createResilientCompletionPort(completion, {
        config: { firstResponseTimeoutMs: 20, requestTimeoutMs: 0, maxRetries: 2 }, sleep: async () => undefined,
      });

      it(`switches after ${CONSECUTIVE_TIMEOUTS_TO_SWITCH} consecutive first-response deadlines within one operation`, async () => {
        const target = recording('cnb');
        const primary = silentThenAnswer(Infinity);
        const { completion, primaryModel, events, registry } = chain(primary.port, [{ id: 'cnb', model: model('cnb-model', 'cnb-account'), port: target.port }]);
        const resilient = resilientOver(completion);
        // no_response is never re-asked on the same model: each request is one attempt.
        await expect(resilient.complete(primaryModel, context)).rejects.toMatchObject({ kind: 'no_response', attempts: 1 });
        await expect(resilient.complete(primaryModel, context)).rejects.toMatchObject({ kind: 'no_response', attempts: 1 });
        expect(target.calls).toHaveLength(0);
        // The next request of the same operation goes to the fallback.
        expect((await resilient.complete(primaryModel, context)).provider).toBe('cnb');
        expect(primary.calls()).toBe(2);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ reason: 'timeout', from: { model: 'gemini-flash' }, to: { model: 'cnb-model' } });
        // One operation never skips the model for everyone.
        expect(registry.unavailable('gemini-account', 'gemini-flash')).toBeUndefined();
      });

      it('a single first-response deadline does not switch', async () => {
        const target = recording('cnb');
        const primary = silentThenAnswer(1);
        const { completion, primaryModel, events, registry } = chain(primary.port, [{ id: 'cnb', model: model('cnb-model', 'cnb-account'), port: target.port }]);
        const resilient = resilientOver(completion);
        await expect(resilient.complete(primaryModel, context)).rejects.toMatchObject({ kind: 'no_response' });
        expect((await resilient.complete(primaryModel, context)).provider).toBe('gemini');
        expect(target.calls).toHaveLength(0);
        expect(events).toEqual([]);
        expect(registry.list()).toEqual([]);
      });

      it('a deadline answered by the primary resets the count', async () => {
        const target = recording('cnb');
        let calls = 0;
        const flaky: LlmCompletionPort = {
          complete: (_m, _c, options) => {
            calls++;
            if (calls === 2) return Promise.resolve(reply('primary answer', 'gemini'));
            return new Promise((_resolve, reject) => {
              options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
            });
          },
          completeSimple: async () => reply('unused', 'gemini'),
        };
        const { completion, primaryModel, events } = chain(flaky, [{ id: 'cnb', model: model('cnb-model', 'cnb-account'), port: target.port }]);
        const resilient = resilientOver(completion);
        await expect(resilient.complete(primaryModel, context)).rejects.toMatchObject({ kind: 'no_response' });
        expect((await resilient.complete(primaryModel, context)).provider).toBe('gemini');
        await expect(resilient.complete(primaryModel, context)).rejects.toMatchObject({ kind: 'no_response' });
        expect(target.calls).toHaveLength(0);
        expect(events).toEqual([]);
      });

      it('a caller-supplied AbortSignal.timeout is not counted', async () => {
        const target = recording('cnb');
        const primary = silentThenAnswer(Infinity);
        const { completion, primaryModel, events } = chain(primary.port, [{ id: 'cnb', model: model('cnb-model', 'cnb-account'), port: target.port }]);
        const resilient = createResilientCompletionPort(completion, {
          config: { firstResponseTimeoutMs: 10_000, requestTimeoutMs: 0, maxRetries: 0 }, sleep: async () => undefined,
        });
        for (let i = 0; i < 3; i++) {
          await expect(resilient.complete(primaryModel, context, { signal: AbortSignal.timeout(5) })).rejects.toBeDefined();
        }
        expect(target.calls).toHaveLength(0);
        expect(events).toEqual([]);
      });
    });

    it('never switches after streamed text, even on repeated timeouts', async () => {
      const target = recording('cnb');
      const streaming: LlmCompletionPort = {
        complete: async (_m, _c, options) => { options?.onTextDelta?.('partial'); throw timeout(); },
        completeSimple: async () => reply('unused', 'gemini'),
      };
      const { completion, primaryModel } = chain(streaming, [{ id: 'cnb', model: model('cnb-model', 'cnb-account'), port: target.port }]);
      for (let i = 0; i < 3; i++) {
        await expect(completion.complete(primaryModel, context, { onTextDelta: () => undefined })).rejects.toMatchObject({ name: 'TimeoutError' });
      }
      expect(target.calls).toHaveLength(0);
    });
  });
});

describe('network errors and 5xx switch after the same-model retries (#1250 b40 fallback-skips-network-and-5xx)', () => {
  const networkError = () => Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
  const badGateway = () => Object.assign(new Error('bad gateway'), { statusCode: 502 });
  type Skip = Parameters<NonNullable<Parameters<typeof createFallbackCompletionPort>[0]['onFallbackSkipped']>>[0];

  /** Ports that fail `failures` times (one per call), then answer. */
  function flaky(name: string, failures: number, error: () => Error) {
    let calls = 0;
    const completion: LlmCompletionPort = {
      complete: async () => { calls++; if (calls <= failures) throw error(); return reply(`${name} answer`, name); },
      completeSimple: async () => reply(`${name} answer`, name),
    };
    return { completion, calls: () => calls };
  }

  function build(input: Readonly<{
    primaryFailures: number;
    fallback1Failures?: number;
    fallback2Failures?: number;
    error: () => Error;
    registry?: ModelAvailabilityRegistry;
    fallbacks?: 0 | 2;
  }>) {
    const registry = input.registry ?? new ModelAvailabilityRegistry({ now: () => 1_000 });
    const primary = flaky('relay', input.primaryFailures, input.error);
    // Fallbacks run under their own resilience policy (`maxRetries: 1` = two attempts each).
    const fallback1 = flaky('backup1', input.fallback1Failures ?? 0, input.error);
    const fallback2 = flaky('backup2', input.fallback2Failures ?? 0, input.error);
    const events: ModelFallbackEvent[] = [];
    const skips: Skip[] = [];
    const primaryModel = model('relay-model', 'relay-account');
    const transport = createFallbackCompletionPort({
      purpose: 'chat', registry, onFallback: event => events.push(event), onFallbackSkipped: event => skips.push(event),
      primary: { endpoint: { profileId: 'relay', accountId: 'relay-account', model: 'relay-model' }, model: primaryModel, completion: primary.completion },
      fallbacks: input.fallbacks === 0 ? [] : [
        { endpoint: { profileId: 'backup1', accountId: 'backup1-account', model: 'backup1-model' },
          resolve: async () => ({ model: { ...model('backup1-model', 'backup1-account'), executionPolicy: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 } },
            completion: fallback1.completion }) },
        { endpoint: { profileId: 'backup2', accountId: 'backup2-account', model: 'backup2-model' },
          resolve: async () => ({ model: { ...model('backup2-model', 'backup2-account'), executionPolicy: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 } },
            completion: fallback2.completion }) },
      ],
    });
    const retries: string[] = [];
    const giveUps: string[] = [];
    // The turn's same-model resilience sits above the fallback port, as in production.
    const completion = createResilientCompletionPort(transport, { config: { maxRetries: 2 }, sleep: async () => undefined,
      onEvent: event => { if (event.type === 'retry') retries.push(event.kind); if (event.type === 'give_up') giveUps.push(event.kind); } });
    return { completion, primary, fallback1, fallback2, events, skips, registry, primaryModel, retries, giveUps };
  }

  it.each([['network', networkError, 'network'], ['502', badGateway, 'server']] as const)(
    'retries the selected model, then answers from fallback 1 on a %s error', async (_name, error, kind) => {
      const run = build({ primaryFailures: 3, error });
      const answer = await run.completion.complete(run.primaryModel, context);
      expect(answer.provider).toBe('backup1');
      // Two same-model retries first (the 9:00 log: two provider_retry), then the switch instead of give_up.
      expect(run.primary.calls()).toBe(3);
      expect(run.retries).toEqual([kind, kind]);
      expect(run.giveUps).toEqual([]);
      expect(run.events).toEqual([expect.objectContaining({ reason: kind, phase: 'request',
        from: expect.objectContaining({ profileId: 'relay' }), to: expect.objectContaining({ profileId: 'backup1' }) })]);
      expect(run.skips).toEqual([]);
      // One operation is not enough to skip the model for everyone.
      expect(run.registry.list()).toEqual([]);
    });

  it.each([['network', networkError, 'network'], ['502', badGateway, 'server']] as const)(
    'moves on to fallback 2 when fallback 1 also fails with a %s error', async (_name, error, kind) => {
      const run = build({ primaryFailures: 3, fallback1Failures: 2, error });
      const answer = await run.completion.complete(run.primaryModel, context);
      expect(answer.provider).toBe('backup2');
      expect(run.fallback1.calls()).toBe(2);
      expect(run.events.map(event => [event.from.profileId, event.to.profileId, event.reason]))
        .toEqual([['relay', 'backup1', kind], ['backup1', 'backup2', kind]]);
    });

  it('records fallback_skipped `exhausted` when every fallback failed', async () => {
    const run = build({ primaryFailures: 3, fallback1Failures: 2, fallback2Failures: 2, error: networkError });
    await expect(run.completion.complete(run.primaryModel, context)).rejects.toThrow();
    expect(run.events.map(event => event.to.profileId)).toEqual(['backup1', 'backup2']);
    expect(run.skips).toEqual([expect.objectContaining({ purpose: 'chat', kind: 'network', reason: 'exhausted',
      from: expect.objectContaining({ profileId: 'backup2' }) })]);
  });

  it('records fallback_skipped `no_fallbacks` when the purpose has none', async () => {
    const run = build({ primaryFailures: 3, error: networkError, fallbacks: 0 });
    await expect(run.completion.complete(run.primaryModel, context)).rejects.toBeInstanceOf(ProviderRequestError);
    expect(run.retries).toEqual(['network', 'network']);
    expect(run.giveUps).toEqual(['network']);
    expect(run.skips).toEqual([expect.objectContaining({ kind: 'network', reason: 'no_fallbacks' })]);
  });

  it('records fallback_skipped `not_switching` for a failure class that does not switch', async () => {
    const run = build({ primaryFailures: 1, error: () => Object.assign(new Error('bad'), { statusCode: 400 }) });
    await expect(run.completion.complete(run.primaryModel, context)).rejects.toThrow('bad');
    expect(run.events).toEqual([]);
    expect(run.skips).toEqual([expect.objectContaining({ kind: 'bad_request', reason: 'not_switching',
      from: expect.objectContaining({ profileId: 'relay' }) })]);
  });

  it('keeps the switch inside the operation; a later operation starts on the primary again', async () => {
    const registry = new ModelAvailabilityRegistry({ now: () => 1_000 });
    const first = build({ primaryFailures: 3, error: networkError, registry });
    expect((await first.completion.complete(first.primaryModel, context)).provider).toBe('backup1');
    // Same operation, next request: stays on the fallback.
    expect((await first.completion.complete(first.primaryModel, context)).provider).toBe('backup1');
    expect(first.primary.calls()).toBe(3);
    // Another operation (the relay is back): answered by the primary, nothing marked.
    const second = build({ primaryFailures: 0, error: networkError, registry });
    expect((await second.completion.complete(second.primaryModel, context)).provider).toBe('relay');
    expect(registry.unavailable('relay-account', 'relay-model')).toBeUndefined();
  });

  it(`skips the model globally only after ${TIMEOUT_GLOBAL_OPERATIONS} operations gave up on it within the window`, async () => {
    let now = 1_000;
    const registry = new ModelAvailabilityRegistry({ now: () => now });
    const first = build({ primaryFailures: 3, error: badGateway, registry });
    await first.completion.complete(first.primaryModel, context);
    expect(registry.unavailable('relay-account', 'relay-model')).toBeUndefined();
    // Outside the window: still counted as a first operation.
    now += TIMEOUT_GLOBAL_WINDOW_MS + 1;
    const second = build({ primaryFailures: 3, error: badGateway, registry });
    await second.completion.complete(second.primaryModel, context);
    expect(registry.unavailable('relay-account', 'relay-model')).toBeUndefined();
    now += 1_000;
    const third = build({ primaryFailures: 3, error: badGateway, registry });
    expect((await third.completion.complete(third.primaryModel, context)).provider).toBe('backup1');
    expect(registry.unavailable('relay-account', 'relay-model')).toMatchObject({ reason: 'server', until: now + TIMEOUT_FALLBACK_COOLDOWN_MS });
    expect(third.events.at(-1)).toMatchObject({ reason: 'server', fromUntil: now + TIMEOUT_FALLBACK_COOLDOWN_MS });
    // Timeouts are counted on their own: these operations do not count toward a timeout skip.
    expect(registry.noteOperationTimeouts({ accountId: 'relay-account', model: 'relay-model', operation: {} })).toBe(false);
  });

  it('uses the short cooldown for network / 5xx skips', () => {
    expect(modelFallbackResetAt({ kind: 'network' }, 0)).toBe(TIMEOUT_FALLBACK_COOLDOWN_MS);
    expect(modelFallbackResetAt({ kind: 'server' }, 0)).toBe(TIMEOUT_FALLBACK_COOLDOWN_MS);
  });
});

describe('the network / 5xx switch follows what the same-model retries actually do (#1250 b40 review)', () => {
  const networkError = () => Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
  type Skip = Parameters<NonNullable<Parameters<typeof createFallbackCompletionPort>[0]['onFallbackSkipped']>>[0];

  function build(primary: LlmCompletionPort) {
    const registry = new ModelAvailabilityRegistry({ now: () => 1_000 });
    const backup = port('backup');
    const events: ModelFallbackEvent[] = [];
    const skips: Skip[] = [];
    const primaryModel = model('relay-model', 'relay-account');
    const transport = createFallbackCompletionPort({
      purpose: 'chat', registry, onFallback: event => events.push(event), onFallbackSkipped: event => skips.push(event),
      primary: { endpoint: { profileId: 'relay', accountId: 'relay-account', model: 'relay-model' }, model: primaryModel, completion: primary },
      fallbacks: [{ endpoint: { profileId: 'backup', accountId: 'backup-account', model: 'backup-model' },
        resolve: async () => ({ model: model('backup-model', 'backup-account'), completion: backup.completion }) }],
    });
    const retries: string[] = [];
    const completion = createResilientCompletionPort(transport, { config: { maxRetries: 2 }, sleep: async () => undefined,
      onEvent: event => { if (event.type === 'retry') retries.push(event.kind); } });
    return { completion, backup, events, skips, registry, primaryModel, retries };
  }

  it('switches on the first 503 whose Retry-After is longer than the same-model retries wait', async () => {
    let calls = 0;
    const longWait = () => Object.assign(new Error('busy'), { statusCode: 503, responseHeaders: { 'retry-after': '600' } });
    const run = build({ complete: async () => { calls++; throw longWait(); }, completeSimple: async () => { throw longWait(); } });
    expect((await run.completion.complete(run.primaryModel, context)).provider).toBe('backup');
    expect(calls).toBe(1);
    expect(run.retries).toEqual([]);
    expect(run.events.map(event => event.reason)).toEqual(['server']);
  });

  it('does not switch or report a skip when the caller cancelled the request', async () => {
    const controller = new AbortController();
    const run = build({
      complete: async () => { controller.abort(); throw networkError(); },
      completeSimple: async () => { throw networkError(); },
    });
    await expect(run.completion.complete(run.primaryModel, context, { signal: controller.signal })).rejects.toThrow();
    expect(run.backup.calls).toHaveLength(0);
    expect(run.events).toEqual([]);
    expect(run.skips).toEqual([]);
    expect(run.retries).toEqual([]);
  });

  it('does not switch once text of the last attempt reached the user', async () => {
    const run = build({
      complete: async (_m, _c, options) => { options?.onTextDelta?.('partial'); throw networkError(); },
      completeSimple: async () => { throw networkError(); },
    });
    await expect(run.completion.complete(run.primaryModel, context, { onTextDelta: () => undefined })).rejects.toThrow();
    expect(run.backup.calls).toHaveLength(0);
    expect(run.retries).toEqual(['network', 'network']);
    expect(run.skips).toEqual([expect.objectContaining({ kind: 'network', reason: 'streamed' })]);
  });

  it('does not switch when the caller forbids another attempt, and reports why', async () => {
    const run = build({ complete: async () => { throw networkError(); }, completeSimple: async () => { throw networkError(); } });
    await expect(run.completion.complete(run.primaryModel, context, { retryAllowed: () => false })).rejects.toThrow();
    expect(run.backup.calls).toHaveLength(0);
    expect(run.retries).toEqual([]);
    expect(run.skips).toEqual([expect.objectContaining({ kind: 'network', reason: 'retry_forbidden' })]);
  });
});
