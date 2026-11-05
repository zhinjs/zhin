import { resolveModelHarness } from '../../src/config/model-harness-runtime.js';
import { agentLoop, assistantAnswerText, createResilientCompletionPort, createUserMessage, isLlmAgentMessage, z } from '@zhin.js/ai';
import { wireMockLlmApi, assistantTextReply, assistantToolCallReply } from '../helpers/mock-llm-api.js';

const gateways = ['anthropic', 'opencode-go', 'opencode-zen'] as const;
const nativeModels = ['minimax-m3', 'minimax/minimax-m3', 'gemini-3.8-flash', 'google/gemini-3.8-pro', 'deepseek-chat', 'deepseek/deepseek-reasoner'] as const;

describe('same-model empty retry defaults on supported gateway Drivers', () => {
  it.each(gateways)('retains model empty-reply defaults through %s', id => {
    for (const modelId of nativeModels) {
      const resolved = resolveModelHarness({ driver: { id, owner: 'root', contractVersion: '1' }, serviceId: 'gateway', modelId });
      expect(resolved.emptyReplyRetries).toBe(1);
      expect(resolved.explorationBudget).toBeUndefined();
      expect(resolved.explorationGuidance).toBeUndefined();
    }
  });

  it.each(['deepseek', 'openai-compatible'])('defaults DeepSeek to one extra attempt through %s', id => {
    for (const modelId of ['deepseek-chat', 'deepseek-reasoner', 'deepseek/deepseek-v3.2']) {
      expect(resolveModelHarness({ driver: { id, owner: 'root', contractVersion: '1' }, serviceId: 'gateway', modelId }).emptyReplyRetries).toBe(1);
    }
  });

  it('preserves Service and exact-model overrides, including explicit zero', () => {
    const input = { driver: { id: 'opencode-zen', owner: 'root', contractVersion: '1' }, serviceId: 'gateway', modelId: 'deepseek-reasoner' };
    expect(resolveModelHarness({ ...input, config: { services: { gateway: { defaults: { emptyReplyRetries: 2 } } } } }).emptyReplyRetries).toBe(2);
    expect(resolveModelHarness({ ...input, config: { services: { gateway: { defaults: { emptyReplyRetries: 2 }, models: { 'deepseek-reasoner': { emptyReplyRetries: 0 } } } } } }).emptyReplyRetries).toBe(0);
  });

  it('does not relax Driver ownership/contracts or match an unrelated native model', () => {
    for (const driver of [{ id: 'opencode-zen', owner: 'root/other', contractVersion: '1' },
      { id: 'opencode-zen', owner: 'root', contractVersion: '2' }, { id: 'unregistered', owner: 'root', contractVersion: '1' }]) {
      expect(resolveModelHarness({ driver, serviceId: 'gateway', modelId: 'deepseek-reasoner' })).toEqual({});
    }
    expect(resolveModelHarness({ driver: { id: 'opencode-zen', owner: 'root', contractVersion: '1' }, serviceId: 'gateway', modelId: 'gpt-deepseek-compare' })).toEqual({});
  });

  it.each([
    { driver: 'anthropic', modelId: 'minimax-m3' },
    { driver: 'opencode-zen', modelId: 'google/gemini-3.8-flash' },
    { driver: 'deepseek', modelId: 'deepseek-reasoner' },
  ].flatMap(candidate => ['default', 'service-zero', 'model-zero'].map(setting => ({ ...candidate, setting }))))('keeps $modelId retries within the same completion ($setting)', async ({ driver, modelId, setting }) => {
    const responses = [assistantToolCallReply([{ id: 'write-1', name: 'write_record', arguments: {} }]),
      assistantTextReply(''), assistantTextReply('done')];
    const llm = wireMockLlmApi({ models: [modelId], responder: () => {
      const response = responses.shift();
      if (!response) throw new Error('Unexpected extra model request');
      return response;
    } });
    const config = setting === 'default' ? undefined : { services: { gateway: {
      defaults: { emptyReplyRetries: setting === 'service-zero' ? 0 : 2 },
      ...(setting === 'model-zero' ? { models: { [modelId]: { emptyReplyRetries: 0 } } } : {}),
    } } };
    const harness = resolveModelHarness({ driver: { id: driver, owner: 'root', contractVersion: '1' }, serviceId: 'gateway', modelId, config });
    const transport = createResilientCompletionPort(llm.runtime, { config: { maxRetries: 0, ...harness }, sleep: async () => undefined });
    const executeTool = vi.fn(async (call: { id: string; name: string }) => ({ role: 'toolResult' as const,
      toolCallId: call.id, toolName: call.name, content: [{ type: 'text' as const, text: 'written' }], isError: false, timestamp: 1 }));
    let answer = '';
    for await (const event of agentLoop(createUserMessage('Write one record'), {
      systemPrompt: '', messages: [], tools: [{ name: 'write_record', description: 'Synthetic write', parameters: z.object({}) }],
    }, { model: llm.runtime.model(llm.provider.name, modelId), transport, executeTool })) {
      if (event.type === 'message_end' && isLlmAgentMessage(event.message) && event.message.role === 'assistant') answer = assistantAnswerText(event.message);
    }
    expect(answer).toBe(setting === 'default' ? 'done' : '');
    expect(llm.calls).toHaveLength(setting === 'default' ? 3 : 2);
    expect(llm.calls.every(call => call.model.id === modelId && call.model.provider === llm.provider.name)).toBe(true);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });
});
