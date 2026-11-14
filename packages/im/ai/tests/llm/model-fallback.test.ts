import {
  AUTH_FALLBACK_COOLDOWN_MS, MODEL_FALLBACK_NOTICE, ModelAvailabilityRegistry, QUOTA_FALLBACK_COOLDOWN_MS,
  createFallbackCompletionPort, modelFallbackFailure, modelFallbackResetAt, nextPacificMidnight,
  type ModelFallbackEvent,
} from '../../src/llm/model-fallback.js';
import { ProviderRequestError, createResilientCompletionPort } from '../../src/llm/provider-resilience.js';
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

  it.each([['server', serverError], ['rate limit', rateLimited], ['plain', new Error('weird')]])('never switches on a %s error', async (_name, error) => {
    const { completion, fallback, events, registry, primaryModel } = setup([error]);
    await expect(completion.complete(primaryModel, context)).rejects.toBe(error);
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
    await expect(exhausted.completion.complete(exhausted.primaryModel, context)).rejects.toBe(billing);
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
