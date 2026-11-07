import { describe, expect, it } from 'vitest';
import {
  MODEL_CAPABILITY_CATALOG,
  applyModelCapabilityDefaults,
  inferDefaultModelInput,
  inferModelCapabilities,
} from '../../src/providers/index.js';
import { materializeAIPlan } from '../../../../toolkit/scaffold-wizard/src/ai.js';

describe('ModelCapabilityCatalog & applyModelCapabilityDefaults', () => {
  it('exposes a non-empty frozen catalog of model capability baselines', () => {
    expect(MODEL_CAPABILITY_CATALOG.length).toBeGreaterThanOrEqual(20);
    expect(Object.isFrozen(MODEL_CAPABILITY_CATALOG)).toBe(true);
  });

  it('infers accurate multimodal, toolCalling, streaming, and thinking capabilities across major families', () => {
    expect(inferModelCapabilities({ modelId: 'gemini-2.5-flash', protocol: 'google-generate-content' })).toMatchObject({
      input: ['text', 'image'],
      streaming: true,
      toolCalling: true,
      thinking: true,
      contextWindow: 1_048_576,
    });
    expect(inferModelCapabilities({ modelId: 'claude-sonnet-4-20250514', protocol: 'anthropic-messages' })).toMatchObject({
      input: ['text', 'image'],
      streaming: true,
      toolCalling: true,
      thinking: true,
      contextWindow: 200_000,
    });
    expect(inferModelCapabilities({ modelId: 'gpt-4o', protocol: 'openai-chat' })).toMatchObject({
      input: ['text', 'image'],
      streaming: true,
      toolCalling: true,
      thinking: false,
      contextWindow: 128_000,
    });
    expect(inferModelCapabilities({ modelId: 'o1-mini', protocol: 'openai-chat' })).toMatchObject({
      input: ['text'],
      streaming: true,
      toolCalling: false,
      thinking: true,
    });
    expect(inferModelCapabilities({ modelId: 'deepseek-reasoner', protocol: 'openai-chat' })).toMatchObject({
      input: ['text'],
      streaming: true,
      toolCalling: true,
      thinking: true,
    });
    expect(inferModelCapabilities({ modelId: 'deepseek-chat', protocol: 'openai-chat' })).toMatchObject({
      input: ['text'],
      streaming: true,
      toolCalling: true,
      thinking: false,
    });
    expect(inferModelCapabilities({ modelId: 'qwen2.5-vl-72b-instruct', protocol: 'openai-chat' })).toMatchObject({
      input: ['text', 'image'],
      streaming: true,
      toolCalling: true,
      thinking: false,
    });
    expect(inferModelCapabilities({ modelId: 'glm-4.6', protocol: 'openai-chat' })).toMatchObject({
      input: ['text'],
      streaming: true,
      toolCalling: true,
      thinking: true,
    });
    expect(inferModelCapabilities({ modelId: 'kimi-k2.5', protocol: 'openai-chat' })).toMatchObject({
      input: ['text', 'image'],
      streaming: true,
      toolCalling: true,
      thinking: true,
    });
    expect(inferModelCapabilities({ modelId: 'MiniMax-M2.7', protocol: 'anthropic-messages' })).toMatchObject({
      input: ['text'],
      streaming: true,
      toolCalling: true,
      thinking: true,
    });
  });

  it('returns non-streaming non-tool text input for non-language models', () => {
    expect(inferModelCapabilities({ modelId: 'gpt-image-1', kinds: ['image'] })).toEqual({
      input: ['text'],
      streaming: false,
      toolCalling: false,
      thinking: false,
    });
    expect(inferDefaultModelInput('gpt-image-1', 'openai-images', ['image'])).toEqual(['text']);
  });

  it('fills omitted ModelDefinition capabilities while honoring explicit user overrides', () => {
    const defaulted = applyModelCapabilityDefaults({
      id: 'gemini-2.5-pro',
      kinds: ['language'],
      protocol: 'google-generate-content',
    });
    expect(defaulted).toEqual({
      id: 'gemini-2.5-pro',
      kinds: ['language'],
      protocol: 'google-generate-content',
      input: ['text', 'image'],
      streaming: true,
      toolCalling: true,
      thinking: true,
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
    });

    const overridden = applyModelCapabilityDefaults({
      id: 'gemini-2.5-pro',
      kinds: ['language'],
      protocol: 'google-generate-content',
      input: ['text'],
      toolCalling: false,
      thinking: false,
      contextWindow: 32_000,
      maxOutputTokens: 4_096,
    });
    expect(overridden).toEqual({
      id: 'gemini-2.5-pro',
      kinds: ['language'],
      protocol: 'google-generate-content',
      input: ['text'],
      streaming: true,
      toolCalling: false,
      thinking: false,
      contextWindow: 32_000,
      maxOutputTokens: 4_096,
    });
  });

  it('aligns scaffold-wizard materializeAIPlan defaults with the capability catalog', () => {
    const plan = materializeAIPlan({
      enabled: true,
      agentProvider: 'google',
      providers: {
        google: { apiKey: '${AI_API_KEY}', models: ['gemini-2.5-flash'] },
        deepseek: { apiKey: '${AI_API_KEY}', models: ['deepseek-reasoner', 'deepseek-chat'] },
      },
    });
    expect(plan).toMatchObject({
      services: {
        google: {
          models: {
            'gemini-2.5-flash': {
              input: ['text', 'image'],
              streaming: true,
              toolCalling: true,
              thinking: true,
            },
          },
        },
        deepseek: {
          models: {
            'deepseek-reasoner': {
              input: ['text'],
              streaming: true,
              toolCalling: true,
              thinking: true,
            },
            'deepseek-chat': {
              input: ['text'],
              streaming: true,
              toolCalling: true,
              thinking: false,
            },
          },
        },
      },
    });
  });
});
