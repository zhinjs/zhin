import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { anthropicMessages, createProviderHarness, geminiGenerate, openaiChat } from '../helpers/provider-harness/index.js';
import { generateTextViaAiSdk } from '../../src/llm/bridge/ai-sdk-stream.js';
import type { LlmRequestInput, LlmRequestObservation } from '../../src/llm/llm-api-runtime.js';
import { createUserMessage } from '../../src/llm/types/agent-message.js';

function captured(observation: LlmRequestObservation | undefined): LlmRequestInput {
  expect(observation?.status).toBe('captured');
  if (observation?.status !== 'captured') throw new Error('Missing request capture');
  return observation.input;
}

describe('semantic request observation at the installed SDK boundary', () => {
  it.each([true, false])('captures final cached text and tool schemas (stream=%s)', async stream => {
    const h = createProviderHarness({ sdk: 'anthropic' }).reply(anthropicMessages.reply({ text: 'ok' }));
    const onRequest = vi.fn();
    const input = { system: '  stable\n', user: 'hello\nworld\n', tools: [
      { name: 'lookup', description: 'Look up a member', parameters: z.object({ name: z.string() }) },
    ] };
    if (stream) await h.complete(input, { onRequest });
    else await generateTextViaAiSdk(h.runtime.resolveLanguageModel(h.alias, h.modelId)!, h.model, h.context(input), { onRequest });
    expect(onRequest).toHaveBeenCalledTimes(1);
    const snapshot = captured(onRequest.mock.calls[0]?.[0]);
    const wire = h.lastRequest().body as Record<string, any>;
    // The existing bridge trims system text; observe what was sent, not the pre-conversion input.
    expect(snapshot.system).toMatchObject({ content: wire.system[0].text, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } });
    expect(JSON.stringify(snapshot.messages)).toContain('cacheControl');
    expect(snapshot.messages).toContainEqual(expect.objectContaining({ role: 'user', content: input.user }));
    expect(snapshot.tools).toEqual([{ name: 'lookup', description: input.tools[0]!.description, inputSchema: wire.tools[0].input_schema }]);
    expect(JSON.stringify(snapshot)).not.toContain('test-key');
    expect(snapshot).not.toHaveProperty('headers');
  });

  it.each([true, false])('includes prompt-mode output instructions without inventing an output schema field (stream=%s)', async stream => {
    const h = createProviderHarness({ sdk: 'deepseek' }).reply(openaiChat.reply({ text: '{"answer":"ok"}' }));
    const schema = { type: 'object', properties: { answer: { type: 'string' } } };
    const onRequest = vi.fn();
    if (stream) await h.complete({ system: 'Base rules', user: 'hello' }, { onRequest, outputSchema: schema });
    else await generateTextViaAiSdk(h.runtime.resolveLanguageModel(h.alias, h.modelId)!, h.model, h.context({ system: 'Base rules', user: 'hello' }), { onRequest, outputSchema: schema });
    const snapshot = captured(onRequest.mock.calls[0]?.[0]);
    expect(snapshot.system).toContain(JSON.stringify(schema));
    expect(snapshot).not.toHaveProperty('output_schema');
    const wire = h.lastRequest().body as Record<string, any>;
    expect(wire.messages.find((message: { role: string }) => message.role === 'system').content).toBe(snapshot.system);
  });

  it('captures Google wire tool names and converted JSON schemas', async () => {
    const h = createProviderHarness({ sdk: 'google' }).reply(geminiGenerate.reply({ text: 'ok' }));
    const onRequest = vi.fn();
    await h.complete({ user: 'hello', tools: [{ name: '1.lookup', description: 'lookup', parameters: z.object({}),
      inputJsonSchema: { type: 'object', properties: { query: {} } },
    }] }, { onRequest });
    const snapshot = captured(onRequest.mock.calls[0]?.[0]);
    const declaration = (h.lastRequest().body as Record<string, any>).tools[0].functionDeclarations[0];
    expect(snapshot.tools[0]?.name).toBe(declaration.name);
    expect(snapshot.tools[0]?.name).not.toBe('1.lookup');
    expect(snapshot.tools[0]?.inputSchema).toMatchObject({ properties: { query: { type: 'string' } } });
  });

  it.each([true, false])('isolates observer mutation and failures from model execution (stream=%s)', async stream => {
    const h = createProviderHarness({ sdk: 'anthropic' }).reply(anthropicMessages.reply({ text: 'ok' }));
    const onRequest = (observation: LlmRequestObservation) => {
      const snapshot = captured(observation);
      (snapshot.messages as unknown[]).splice(0);
      throw new Error('diagnostic failed');
    };
    const message = stream ? await h.complete({ system: 'keep', user: 'hello' }, { onRequest })
      : await generateTextViaAiSdk(h.runtime.resolveLanguageModel(h.alias, h.modelId)!, h.model, h.context({ system: 'keep', user: 'hello' }), { onRequest });
    expect(message.content).toContainEqual({ type: 'text', text: 'ok' });
    expect(JSON.stringify(h.lastRequest().body)).toContain('hello');
  });

  it('does not await async observers or surface their rejected promises', async () => {
    const h = createProviderHarness({ sdk: 'anthropic' }).reply(anthropicMessages.reply({ text: 'ok' }));
    const message = await h.complete('hello', { onRequest: async () => { throw new Error('diagnostic rejected'); } });
    expect(message.content).toContainEqual({ type: 'text', text: 'ok' });
  });

  it('observes the input even when the provider rejects the attempt', async () => {
    const h = createProviderHarness({ sdk: 'anthropic' }).reply(anthropicMessages.error(400, { type: 'invalid_request_error', message: 'rejected' }));
    const onRequest = vi.fn();
    await expect(h.complete('hello', { onRequest, maxRetries: 0 })).rejects.toThrow();
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(captured(onRequest.mock.calls[0]?.[0]).messages).toHaveLength(1);
    expect(h.requests).toHaveLength(1);
  });

  it('removes media bytes before delivering a snapshot without changing the sent image', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1UAAAAASUVORK5CYII=';
    const h = createProviderHarness({ sdk: 'anthropic' }).reply(anthropicMessages.reply({ text: 'ok' }));
    const onRequest = vi.fn();
    await h.complete({ messages: [{ ...createUserMessage('look'), media: [
      { type: 'image', data: { media: { kind: 'base64', value: png, mime_type: 'image/png' } } },
    ] }] }, { onRequest });
    const snapshot = captured(onRequest.mock.calls[0]?.[0]);
    expect(JSON.stringify(snapshot)).not.toContain(png);
    expect(JSON.stringify(snapshot)).toContain('"omitted":true');
    expect(JSON.stringify(h.lastRequest().body)).toContain(png);
  });
});
