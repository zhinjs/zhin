import { describe, expect, it } from 'vitest';
import { buildAiOutboundJsonSchema } from '@zhin.js/core';
import { createProviderHarness } from '../../../ai/tests/helpers/provider-harness/index.js';

const schema = buildAiOutboundJsonSchema();
function mediaEnums(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value)) return value.reduce((sum, child) => sum + mediaEnums(child), 0);
  const object = value as Record<string, unknown>;
  return (JSON.stringify(object.enum) === JSON.stringify(['image', 'audio', 'video', 'file']) ? 1 : 0)
    + Object.values(object).reduce<number>((sum, child) => sum + mediaEnums(child), 0);
}

describe('compact message schema on the installed provider SDKs', () => {
  it.each(['openai', 'anthropic', 'google'] as const)('%s sends the single shared media shape', async sdk => {
    const h = createProviderHarness({ sdk });
    const request = await h.capture('hello', { outputSchema: schema });
    expect(mediaEnums(request.body)).toBe(1);
    expect(JSON.stringify(request.body)).not.toContain('$ref');
  });
  it.each(['deepseek', 'openai-compatible'] as const)('%s prompt mode serializes the same compact schema once', async sdk => {
    const h = createProviderHarness({ sdk, config: { compat: { structuredOutput: 'prompt' } } });
    const request = await h.capture('hello', { outputSchema: schema });
    const text = JSON.stringify(request.body);
    expect(text.split(JSON.stringify(JSON.stringify(schema)).slice(1, -1))).toHaveLength(2);
  });
});
