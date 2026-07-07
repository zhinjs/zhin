import { describe, it, expect } from 'vitest';
import {
  applyProviderGatewayPreset,
  inferModelReasoning,
  resolveTransportContextWindow,
  validateProviderGatewayConfig,
} from '../../src/llm/provider-gateway-presets.js';

describe('provider-gateway-presets', () => {
  it('coerces OpenCode Zen to openai-compatible', () => {
    const out = applyProviderGatewayPreset('opencode', {
      sdk: 'openai',
      baseUrl: 'https://opencode.ai/zen/v1',
      apiKey: 'k',
    });
    expect(out.sdk).toBe('openai-compatible');
    expect(out.contextWindow).toBe(32_768);
    expect(out.compat?.supportsReasoningContent).toBe(true);
  });

  it('preserves explicit contextWindow on gateway preset', () => {
    const out = applyProviderGatewayPreset('opencode', {
      sdk: 'openai-compatible',
      baseUrl: 'https://opencode.ai/zen/v1',
      contextWindow: 16_384,
    });
    expect(out.contextWindow).toBe(16_384);
  });

  it('warns when OpenCode uses sdk openai', () => {
    const warnings = validateProviderGatewayConfig('opencode', {
      sdk: 'openai',
      baseUrl: 'https://opencode.ai/zen/v1',
    });
    expect(warnings.some((w) => w.includes('openai-compatible'))).toBe(true);
  });

  it('infers reasoning models', () => {
    expect(inferModelReasoning('mimo-v2.5-free')).toBe(true);
    expect(inferModelReasoning('deepseek-v4-flash-free')).toBe(true);
    expect(inferModelReasoning('gpt-4.1-mini')).toBe(false);
  });

  it('resolveTransportContextWindow uses provider then model heuristics', () => {
    expect(resolveTransportContextWindow({ sdk: 'openai-compatible', contextWindow: 20_000 }, 'any')).toBe(20_000);
    expect(resolveTransportContextWindow({ sdk: 'openai-compatible', baseUrl: 'https://opencode.ai/zen/v1' }, 'mimo-v2.5-free')).toBe(32_768);
    expect(resolveTransportContextWindow({ sdk: 'openai' }, 'foo-8k')).toBe(8_192);
  });
});
