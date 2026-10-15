/**
 * S8 / S20: the agent's thinking level and the provider's `maxOutputTokens` reach the
 * request. Request bodies come from the shared provider harness (`h.capture`).
 */
import { describe, expect, it } from 'vitest';
import { createLlmTransportModel, DEFAULT_MAX_OUTPUT_TOKENS } from '../../src/llm/llm-api-runtime.js';
import { resolveReasoningOption } from '../../src/llm/bridge/ai-sdk-stream.js';
import type { ThinkingLevel } from '../../src/llm/types/agent-event.js';
import type { ProviderInstanceConfig } from '../../src/llm/types/model.js';
import { createProviderHarness } from '../helpers/provider-harness/index.js';

async function requestBody({ sdk, ...config }: ProviderInstanceConfig, modelId: string, thinkingLevel?: ThinkingLevel) {
  const h = createProviderHarness({ sdk, model: modelId, config });
  const { body } = await h.capture({ system: 's', user: 'hi' }, { thinkingLevel });
  return body;
}

describe('reasoning level (S8)', () => {
  it('Gemini 3: thinkingLevel becomes generationConfig.thinkingConfig.thinkingLevel; off is minimal', async () => {
    const high = await requestBody({ sdk: 'google', apiKey: 'k' }, 'gemini-3.8-flash', 'high');
    expect(high.generationConfig.thinkingConfig).toMatchObject({ thinkingLevel: 'high' });
    const off = await requestBody({ sdk: 'google', apiKey: 'k' }, 'gemini-3.8-flash', 'off');
    expect(off.generationConfig.thinkingConfig).toMatchObject({ thinkingLevel: 'minimal' });
  });

  it('uses the provider config thinkingLevel when the call sets none', async () => {
    const body = await requestBody({ sdk: 'google', apiKey: 'k', thinkingLevel: 'low' }, 'gemini-3.8-flash');
    expect(body.generationConfig.thinkingConfig).toMatchObject({ thinkingLevel: 'low' });
  });

  it('providerOptions thinkingConfig wins over thinkingLevel', async () => {
    const body = await requestBody(
      { sdk: 'google', apiKey: 'k', thinkingLevel: 'high', providerOptions: { google: { thinkingConfig: { thinkingLevel: 'low' } } } },
      'gemini-3.8-flash',
      'high',
    );
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('Claude: thinkingLevel enables thinking', async () => {
    const body = await requestBody({ sdk: 'anthropic', apiKey: 'k', maxOutputTokens: 32_000 }, 'claude-sonnet-4-5', 'medium');
    expect(body.thinking).toMatchObject({ type: 'enabled' });
    expect(body.thinking.budget_tokens).toBeGreaterThan(0);
  });

  it('OpenAI reasoning models: thinkingLevel becomes reasoning_effort', async () => {
    const body = await requestBody({ sdk: 'openai', apiKey: 'k' }, 'gpt-5', 'low');
    expect(body.reasoning_effort).toBe('low');
  });

  it('no thinkingLevel leaves the request unchanged', async () => {
    const body = await requestBody({ sdk: 'google', apiKey: 'k' }, 'gemini-3.8-flash');
    expect(body.generationConfig?.thinkingConfig).toBeUndefined();
    const openai = await requestBody({ sdk: 'openai', apiKey: 'k' }, 'gpt-5');
    expect(openai.reasoning_effort).toBeUndefined();
  });

  it('MiniMax keeps adaptive thinking', () => {
    expect(resolveReasoningOption({ sdk: 'minimax' }, 'high')).toBeUndefined();
    expect(resolveReasoningOption({ sdk: 'deepseek' }, 'off')).toBe('none');
    expect(resolveReasoningOption({ sdk: 'anthropic', providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 2048 } } } }, 'high')).toBeUndefined();
  });
});

describe('maxOutputTokens (S20)', () => {
  it('defaults to 8192 and follows the provider config', async () => {
    expect(createLlmTransportModel('p', { sdk: 'google' }, 'gemini-3.8-flash').maxTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    const body = await requestBody({ sdk: 'google', apiKey: 'k', maxOutputTokens: 32_768 }, 'gemini-3.8-flash');
    expect(body.generationConfig.maxOutputTokens).toBe(32_768);
  });
});
