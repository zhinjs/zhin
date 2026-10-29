/**
 * ADR 0042 §1: the system prompt is sent as stable + scene. Anthropic gets two system blocks with
 * cache_control on the stable block only; other providers get one string, stable first.
 */
import { describe, expect, it } from 'vitest';
import { createLlmApiRuntime } from '../../src/llm/llm-runtime-factory.js';
import { createLlmTransportModel } from '../../src/llm/llm-api-runtime.js';
import { createUserMessage } from '../../src/llm/types/agent-message.js';
import type { ProviderInstanceConfig } from '../../src/llm/types/model.js';
import { splitSystemPrompt } from '../../src/llm/bridge/ai-sdk-messages.js';
import { wrapSystemForPromptCache } from '../../src/llm/bridge/ai-sdk-prompt-cache.js';

const STABLE = 'STABLE persona, rules and security. '.repeat(20).trim();
const SCENE = '[scene_id:g1;scene_type:group;]';
const SEP = '\n\n---\n\n';
const SYSTEM = `${STABLE}${SEP}${SCENE}`;
const BREAKPOINT = STABLE.length + SEP.length;

function anthropicStream(): string {
  const events: Array<[string, unknown]> = [
    ['message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'm', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

async function capture(sdk: 'anthropic' | 'openai-compatible', breakpoint: number | undefined) {
  const bodies: Array<Record<string, any>> = [];
  const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return sdk === 'anthropic'
      ? new Response(anthropicStream(), { status: 200, headers: { 'content-type': 'text/event-stream' } })
      : Response.json({ id: 'c', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }) as typeof globalThis.fetch;
  const config = { sdk, apiKey: 'k', ...(sdk === 'openai-compatible' ? { baseUrl: 'https://example.test/v1' } : {}) } as ProviderInstanceConfig;
  const runtime = createLlmApiRuntime([{ alias: 'p', config, models: ['m'], fetch }], () => ['m']);
  await runtime.complete(createLlmTransportModel('p', config, 'm'), {
    systemPrompt: SYSTEM,
    systemPromptCacheBreakpoint: breakpoint,
    messages: [createUserMessage('hi')],
  });
  return bodies[0]!;
}

describe('system prompt cache breakpoint (ADR 0042 §1)', () => {
  it('splits only when both halves have text', () => {
    expect(splitSystemPrompt(SYSTEM, BREAKPOINT)).toEqual({ stable: STABLE, scene: SCENE });
    expect(splitSystemPrompt(SYSTEM, undefined)).toBeUndefined();
    expect(splitSystemPrompt(SYSTEM, 0)).toBeUndefined();
    expect(splitSystemPrompt(SYSTEM, SYSTEM.length)).toBeUndefined();
  });

  it('wrapSystemForPromptCache marks the stable block only, and only for anthropic', () => {
    const parts = { stable: STABLE, scene: SCENE };
    const out = wrapSystemForPromptCache(SYSTEM, { enabled: true, sdk: 'anthropic' }, parts);
    expect(out).toEqual([
      { role: 'system', content: STABLE, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
      { role: 'system', content: SCENE },
    ]);
    expect(wrapSystemForPromptCache(SYSTEM, { enabled: true, sdk: 'openai-compatible' }, parts)).toBe(SYSTEM);
    expect(wrapSystemForPromptCache(SYSTEM, { enabled: true, sdk: 'openai' }, parts)).toBe(SYSTEM);
    expect(wrapSystemForPromptCache(SYSTEM, { enabled: false, sdk: 'anthropic' }, parts)).toBe(SYSTEM);
  });

  it('keeps a single cached block for single-string callers', () => {
    expect(wrapSystemForPromptCache(SYSTEM, { enabled: true, sdk: 'anthropic' })).toMatchObject({ role: 'system', content: SYSTEM });
  });

  it('anthropic request: two system blocks, cache_control on the stable block only', async () => {
    const body = await capture('anthropic', BREAKPOINT);
    expect(body.system).toHaveLength(2);
    expect(body.system[0]).toMatchObject({ type: 'text', text: STABLE, cache_control: { type: 'ephemeral' } });
    expect(body.system[1]).toEqual({ type: 'text', text: SCENE });
  });

  it('anthropic request without a breakpoint keeps one cached system block', async () => {
    const body = await capture('anthropic', undefined);
    expect(body.system).toHaveLength(1);
    expect(body.system[0]).toMatchObject({ text: SYSTEM, cache_control: { type: 'ephemeral' } });
  });

  it('openai-compatible request: one system string, stable first', async () => {
    const body = await capture('openai-compatible', BREAKPOINT);
    const systems = body.messages.filter((m: { role: string }) => m.role === 'system');
    expect(systems).toHaveLength(1);
    expect(systems[0].content).toBe(SYSTEM);
    expect(systems[0].content.startsWith(STABLE)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });
});
