import { z } from 'zod';
import { asSchema } from 'ai';
import { estimateContextFixedTokens } from '../../src/compaction/context-budget.js';
import { estimateTextTokens } from '../../src/compaction/token-counter.js';
import { llmToolsToAiSdk } from '../../src/llm/bridge/ai-sdk-messages.js';
import { withStructuredOutputInstruction } from '../../src/llm/bridge/prompt-structured-output.js';
import type { LlmTool } from '../../src/llm/types/tool.js';

describe('fixed request budget', () => {
  it('counts an Anthropic deferred schema only after disclosure, without applying deferral to other SDKs', async () => {
    const deferred: LlmTool = { name: 'lookup', description: '查询', deferLoading: true,
      parameters: z.object({ query: z.string().describe('字段说明'.repeat(100)) }) };
    expect(await estimateContextFixedTokens({ systemPrompt: '', tools: [deferred], model: { sdk: 'anthropic' } })).toBe(0);
    expect(await estimateContextFixedTokens({ systemPrompt: '', tools: [{ ...deferred, deferLoading: false }], model: { sdk: 'anthropic' } }))
      .toBeGreaterThan(400);
    expect(await estimateContextFixedTokens({ systemPrompt: '', tools: [deferred], model: { sdk: 'openai' } })).toBeGreaterThan(400);
  });

  it.each(['openai', 'google'])('counts the complete %s wire schema including enum and descriptions', async (sdk) => {
    const tool: LlmTool = { name: 'lookup', description: '查资料', parameters: z.object({ query: z.string() }),
      inputJsonSchema: { type: 'object', properties: { query: { enum: ['长说明'.repeat(2000)], description: '字段说明'.repeat(100) } } } };
    const parameters = await asSchema(llmToolsToAiSdk([tool], { sdk })!.lookup.inputSchema).jsonSchema;
    const expected = estimateTextTokens('系统') + estimateTextTokens(JSON.stringify({ name: tool.name, description: tool.description, parameters }));
    expect(await estimateContextFixedTokens({ systemPrompt: '系统', tools: [tool], model: { sdk } })).toBe(expected);
    expect(expected).toBeGreaterThan(6000);
  });

  it('converts Zod-only tool schemas and counts newly disclosed tools', async () => {
    const tools: LlmTool[] = [{ name: 'one', description: '', parameters: z.object({ query: z.string().describe('说明'.repeat(100)) }) }];
    const before = await estimateContextFixedTokens({ systemPrompt: '', tools });
    expect(before).toBeGreaterThan(200);
    const after = await estimateContextFixedTokens({ systemPrompt: '', tools: [...tools, { ...tools[0], name: 'two' }] });
    expect(after).toBeGreaterThanOrEqual(before * 2);
  });

  it.each(['openai', 'deepseek'])('counts the structured output schema once for %s', async (sdk) => {
    const systemPrompt = '系统';
    const outputSchema = { type: 'object', properties: { title: { type: 'string', description: '文案'.repeat(100) } } };
    const expected = sdk === 'deepseek'
      ? estimateTextTokens(withStructuredOutputInstruction({ systemPrompt, messages: [] }, outputSchema).systemPrompt)
      : estimateTextTokens(systemPrompt) + estimateTextTokens(JSON.stringify(outputSchema));
    expect(await estimateContextFixedTokens({ systemPrompt, model: { sdk }, outputSchema })).toBe(expected);
  });
});
