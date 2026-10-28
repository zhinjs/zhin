import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { agentLoop, createResilientCompletionPort, createUserMessage, EMPTY_TOKEN_USAGE, type AssistantMessage, type LlmCompletionPort } from '@zhin.js/ai';
import { createProviderHarness, openaiChat } from '../../../ai/tests/helpers/provider-harness/index.js';
import { trackTurnCompletionUsage } from '../../src/core/turn-completion-usage.js';
import { TurnTraceCollector } from '../../src/trace/turn-trace.js';
import { registerTurnTrace } from '../../src/trace/turn-trace-registry.js';
import { generateTextViaAiSdk } from '../../../ai/src/llm/bridge/ai-sdk-stream.js';

const releases: Array<() => void> = [];
afterEach(() => { for (const release of releases.splice(0)) release(); vi.restoreAllMocks(); });

function traceTransport(delegate: LlmCompletionPort, recordBodies = true) {
  const trace = new TurnTraceCollector({ turnId: 'request-trace-test', sessionKey: 'fixture' });
  releases.push(registerTurnTrace(trace));
  const tracker = trackTurnCompletionUsage(delegate, undefined, { turnId: trace.turnId, recordBodies });
  return { trace, tracker, snapshot() {
    for (const event of tracker.drainEvents()) trace.record(event);
    return trace.snapshot();
  } };
}

describe('turn requests through real SDK and completion boundaries', () => {
  it.each([true, false])('keeps SDK internal same-input retries in one semantic request (stream=%s)', async stream => {
    const h = createProviderHarness({ sdk: 'openai' })
      .reply(openaiChat.error(503, { message: 'unavailable' }))
      .reply(openaiChat.reply({ text: 'done', usage: { prompt: 18, completion: 2 } }));
    const complete: LlmCompletionPort['complete'] = (model, context, options) =>
      generateTextViaAiSdk(h.runtime.resolveLanguageModel(h.alias, h.modelId)!, model, context, options);
    const t = traceTransport(stream ? h.runtime : { complete, completeSimple: complete });
    const onRequest = vi.fn();
    await t.tracker.transport.complete(h.model, h.context('same input'), { maxRetries: 1, onRequest });
    const result = t.snapshot();
    expect(h.requests).toHaveLength(2);
    expect(h.requests[0]!.body).toEqual(h.requests[1]!.body);
    // AI SDK v7 emits per streaming retry, but once before generateText's retry loop.
    expect(onRequest).toHaveBeenCalledTimes(stream ? 2 : 1);
    expect(result.requests).toMatchObject([{ status: 'completed', body_status: 'recorded' }]);
    expect(result.requests).toHaveLength(1);
    expect(result.model_calls).toHaveLength(1);
    expect(result.model_calls[0]).toMatchObject({ request_id: result.requests![0]!.request_id, prompt_tokens: 18 });
  });

  it('correlates retry attempts with the one successful usage response', async () => {
    const h = createProviderHarness({ sdk: 'openai' })
      .reply(openaiChat.error(503, { message: 'unavailable' }))
      .reply(openaiChat.reply({ text: 'done', usage: { prompt: 21, completion: 3 } }));
    const t = traceTransport(h.runtime);
    const port = createResilientCompletionPort(t.tracker.transport, { config: { maxRetries: 1, requestTimeoutMs: 0 }, sleep: async () => {} });
    await port.complete(h.model, h.context('hello'));
    const result = t.snapshot();
    expect(h.requests).toHaveLength(2);
    expect(result.requests).toMatchObject([
      { status: 'failed', body_status: 'recorded', model: h.model.id },
      { status: 'completed', body_status: 'recorded', model: h.model.id },
    ]);
    expect(new Set(result.requests!.map(request => request.request_id)).size).toBe(2);
    expect(result.model_calls).toHaveLength(1);
    expect(result.model_calls[0]).toMatchObject({ request_id: result.requests![1]!.request_id, prompt_tokens: 21, completion_tokens: 3 });
    expect(JSON.stringify(result.requests)).not.toContain('test-key');
  });

  it('retains the actual selected model for fallback attempts', async () => {
    const first = createProviderHarness({ sdk: 'openai', model: 'first-model' }).reply(openaiChat.error(503, { message: 'unavailable' }));
    const second = createProviderHarness({ sdk: 'openai', model: 'second-model' }).reply(openaiChat.reply({ text: 'done' }));
    const complete: LlmCompletionPort['complete'] = (model, context, options) =>
      (model.id === first.model.id ? first : second).runtime.complete(model, context, options);
    const t = traceTransport({ complete, completeSimple: complete });
    const port = createResilientCompletionPort(t.tracker.transport, { config: { maxRetries: 0, requestTimeoutMs: 0 }, fallbackModels: [second.model] });
    await port.complete(first.model, first.context('hello'));
    expect(t.snapshot().requests?.map(request => [request.model, request.status])).toEqual([
      ['first-model', 'failed'], ['second-model', 'completed'],
    ]);
    expect(first.requests).toHaveLength(1);
    expect(second.requests).toHaveLength(1);
  });

  it('records the rebuilt input after actual loop compaction rather than copying the first attempt', async () => {
    const h = createProviderHarness({ sdk: 'openai' })
      .reply(openaiChat.error(400, { message: 'maximum context length exceeded', code: 'context_length_exceeded' }))
      .reply(openaiChat.reply({ text: 'done' }));
    const t = traceTransport(h.runtime);
    for await (const _event of agentLoop(createUserMessage('current'),
      { systemPrompt: 'rules', messages: [createUserMessage('old history')], tools: [] },
      { model: h.model, transport: t.tracker.transport, streamOptions: { maxRetries: 0 },
        onContextOverflow: async () => [createUserMessage('compacted context')],
      })) { /* Drain the existing loop. */ }
    const result = t.snapshot();
    expect(result.requests).toHaveLength(2);
    expect(JSON.stringify(result.requests![0]!.body)).toContain('old history');
    expect(JSON.stringify(result.requests![1]!.body)).toContain('compacted context');
    expect(JSON.stringify(result.requests![1]!.body)).not.toContain('old history');
  });

  it('retains usage while body capture is disabled', async () => {
    const h = createProviderHarness({ sdk: 'openai' }).reply(openaiChat.reply({ text: 'done', usage: { prompt: 12, completion: 2 } }));
    const t = traceTransport(h.runtime, false);
    await t.tracker.transport.completeSimple(h.model, h.context('private input'));
    const result = t.snapshot();
    expect(result.requests).toMatchObject([{ status: 'completed', body_status: 'disabled' }]);
    expect(result.requests![0]).not.toHaveProperty('body');
    expect(result.model_calls[0]).toMatchObject({ request_id: result.requests![0]!.request_id, prompt_tokens: 12 });
    expect(JSON.stringify(result)).not.toContain('private input');
  });

  it('captures the refreshed tool set on the actual tools-mutating re-completion', async () => {
    const h = createProviderHarness({ sdk: 'openai' })
      .reply(openaiChat.reply({ toolCalls: [{ name: 'load_skill', arguments: {} }] }))
      .reply(openaiChat.reply({ text: 'done' }));
    const t = traceTransport(h.runtime);
    const load = { name: 'load_skill', description: 'Load a skill', parameters: z.object({}) };
    const lookup = { name: 'lookup', description: 'Find a record', parameters: z.object({ query: z.string() }) };
    let loaded = false;
    for await (const _event of agentLoop(createUserMessage('look up a record'),
      { systemPrompt: 'rules', messages: [], tools: [load] },
      { model: h.model, transport: t.tracker.transport, streamOptions: { maxRetries: 0 },
        refreshTools: async () => loaded ? [load, lookup] : [load],
        shouldRecompleteAfterTool: message => message.role === 'toolResult',
        executeTool: async call => {
          loaded = true;
          return { role: 'toolResult', toolCallId: call.id, toolName: call.name, isError: false,
            content: [{ type: 'text', text: 'Skill loaded' }], timestamp: Date.now() };
        },
      })) { /* Drain the existing re-completion path. */ }
    const result = t.snapshot();
    expect(result.requests).toHaveLength(2);
    expect(result.requests![0]!.body?.tools?.map(tool => tool.name)).toEqual(['load_skill']);
    expect(result.requests![1]!.body?.tools?.map(tool => tool.name)).toEqual(['load_skill', 'lookup']);
    expect(JSON.stringify(result.requests![1]!.body?.messages)).toContain('Skill loaded');
    expect(result.model_calls.map(call => call.request_id)).toEqual(result.requests!.map(request => request.request_id));
  });

  it('marks unsupported custom transports explicitly without reconstructing their input', async () => {
    const h = createProviderHarness({ sdk: 'openai' });
    const assistant: AssistantMessage = { role: 'assistant', content: [{ type: 'text', text: 'done' }],
      model: h.model.id, provider: h.model.provider, api: 'custom', timestamp: 1, usage: EMPTY_TOKEN_USAGE, stopReason: 'stop' };
    const t = traceTransport({ complete: async () => assistant, completeSimple: async () => assistant });
    await t.tracker.transport.complete(h.model, h.context('not known to custom transport'));
    const result = t.snapshot();
    expect(result.requests).toMatchObject([{ status: 'completed', body_status: 'unsupported' }]);
    expect(result.requests![0]).not.toHaveProperty('body');
  });

  it('records cancelled attempts without inventing a usage record', async () => {
    const controller = new AbortController();
    const h = createProviderHarness({ sdk: 'openai' }).reply(() => {
      controller.abort();
      return { hang: 'before-headers' };
    });
    const t = traceTransport(h.runtime);
    await expect(t.tracker.transport.complete(h.model, h.context('hello'), { signal: controller.signal, maxRetries: 0 })).rejects.toThrow();
    const result = t.snapshot();
    expect(result.requests).toMatchObject([{ status: 'cancelled', body_status: 'recorded' }]);
    expect(result.model_calls).toHaveLength(0);
  });

  it('does not fail or retry the model when trace recording throws', async () => {
    const h = createProviderHarness({ sdk: 'openai' }).reply(openaiChat.reply({ text: 'done' }));
    const t = traceTransport(h.runtime);
    vi.spyOn(t.trace, 'note').mockImplementation(() => { throw new Error('trace unavailable'); });
    const reply = await t.tracker.transport.complete(h.model, h.context('hello'));
    expect(reply.content).toContainEqual({ type: 'text', text: 'done' });
    expect(h.requests).toHaveLength(1);
    expect(t.tracker.drainEvents()).toHaveLength(1);
  });
});
