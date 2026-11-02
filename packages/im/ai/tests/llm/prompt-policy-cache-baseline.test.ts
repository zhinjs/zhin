/** Synthetic HTTP requests through the installed SDKs; no provider cache-hit claim. */
import { z } from 'zod';
import { anthropicMessages, createProviderHarness, openaiChat } from '../helpers/provider-harness/index.js';
import { buildPromptCacheKey } from '../../src/llm/bridge/ai-sdk-prompt-cache.js';
import { generateTextViaAiSdk } from '../../src/llm/bridge/ai-sdk-stream.js';
import type { StreamOptions } from '../../src/llm/llm-api-runtime.js';

const tool = (units: boolean) => ({
  name: 'weather', description: 'Synthetic weather lookup.',
  parameters: units ? z.object({ city: z.string(), units: z.enum(['metric', 'imperial']) }) : z.object({ city: z.string() }),
});

describe('current prompt content with retained provider cache routing', () => {
  it.each(['openai', 'openai-compatible'] as const)('%s keeps its routing key but sends changed policy and schemas', async sdk => {
    const h = createProviderHarness({ sdk, config: { compat: { promptCacheKey: true } } })
      .reply(openaiChat.reply({ text: 'first' }), openaiChat.reply({ text: 'second' }), openaiChat.reply({ text: 'third' }));
    const cache = { promptCacheKey: buildPromptCacheKey({ label: 'orchestrator', provider: h.alias, modelId: h.modelId }) };
    await h.complete({ system: 'POLICY_A', user: 'synthetic task', tools: [tool(false)] }, cache);
    await h.complete({ system: 'POLICY_B', user: 'synthetic task', tools: [tool(true)] }, cache);
    const [first, second] = h.requests.map(request => request.body);
    expect(first!.prompt_cache_key).toBe(cache.promptCacheKey);
    expect(second!.prompt_cache_key).toBe(cache.promptCacheKey);
    expect(JSON.stringify(second!.messages)).toContain('POLICY_B');
    expect(JSON.stringify(second!.messages)).not.toContain('POLICY_A');
    expect(first!.tools[0].function.parameters.properties).not.toHaveProperty('units');
    expect(second!.tools[0].function.parameters.properties.units.enum).toEqual(['metric', 'imperial']);
    await h.complete({ system: 'POLICY_C', user: 'synthetic task' }, { ...cache, promptCache: false });
    expect(h.lastRequest().body).not.toHaveProperty('prompt_cache_key');
    expect(JSON.stringify(h.lastRequest().body.messages)).toContain('POLICY_C');
  });

  it.each([true, false])('Anthropic marks the current policy and input, not an earlier snapshot (stream=%s)', async stream => {
    const h = createProviderHarness({ sdk: 'anthropic' })
      .reply(anthropicMessages.reply({ text: 'first' }), anthropicMessages.reply({ text: 'second' }), anthropicMessages.reply({ text: 'third' }));
    const complete = (system: string, user: string, options?: StreamOptions) => {
      const input = { system, user, tools: [tool(true)] };
      return stream ? h.complete(input, options)
        : generateTextViaAiSdk(h.runtime.resolveLanguageModel(h.alias, h.modelId)!, h.model, h.context(input), options);
    };
    await complete('POLICY_A', 'INPUT_A');
    await complete('POLICY_B', 'INPUT_B');
    const second = h.lastRequest().body;
    expect(second.system).toEqual([{ type: 'text', text: 'POLICY_B', cache_control: { type: 'ephemeral' } }]);
    expect(second.messages.at(-1).content.at(-1)).toMatchObject({
      type: 'text', text: 'INPUT_B', cache_control: { type: 'ephemeral' },
    });
    expect(second.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    expect(JSON.stringify(second)).not.toMatch(/POLICY_A|INPUT_A/);
    await complete('POLICY_C', 'INPUT_C', { promptCache: false });
    expect(JSON.stringify(h.lastRequest().body)).not.toContain('cache_control');
    expect(JSON.stringify(h.lastRequest().body)).toContain('POLICY_C');
  });
});
