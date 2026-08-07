import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  agentMessagesToOpenAi,
  contextToChatCompletionRequest,
  chatCompletionToAssistantMessage,
  createContext,
  createUserMessage,
  assistantText,
} from '../../src/llm/index.js';

describe('openai-bridge', () => {
  it('converts user + toolResult to OpenAI messages', () => {
    const openAi = agentMessagesToOpenAi([
      createUserMessage('hi'),
      {
        role: 'toolResult',
        toolCallId: 'c1',
        toolName: 'echo',
        content: [{ type: 'text', text: 'pong' }],
        isError: false,
        timestamp: 1,
      },
    ]);
    expect(openAi).toHaveLength(1);
    expect(openAi[0]?.role).toBe('user');
  });

  it('builds chat completion request with tools', () => {
    const ctx = createContext('sys', [createUserMessage('q')], [{
      name: 'echo',
      description: 'echo',
      parameters: z.object({ message: z.string() }),
    }]);
    const req = contextToChatCompletionRequest(
      {
        id: 'gpt-test',
        provider: 'openai',
        api: 'openai-completions',
        input: ['text'],
        contextWindow: 128000,
        maxTokens: 4096,
      },
      ctx,
    );
    expect(req.model).toBe('gpt-test');
    expect(req.messages[0]?.role).toBe('system');
    expect(req.tools?.length).toBe(1);
  });

  it('maps tool_calls response to assistant content blocks', () => {
    const assistant = chatCompletionToAssistantMessage(
      {
        id: '1',
        object: 'chat.completion',
        created: 0,
        model: 'gpt-test',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'echo', arguments: '{"message":"x"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      },
      {
        id: 'gpt-test',
        provider: 'openai',
        api: 'openai-completions',
        input: ['text'],
        contextWindow: 128000,
        maxTokens: 4096,
      },
    );
    expect(assistant.stopReason).toBe('toolCalls');
    expect(assistant.content.some((b) => b.type === 'toolCall')).toBe(true);
  });

  it('passes http image URLs through to OpenAI image_url parts', () => {
    const openAi = agentMessagesToOpenAi([
      createUserMessage('see', [{
        type: 'image',
        data: { media: { kind: 'url', value: 'https://example.com/a.jpg', mime_type: 'image/jpeg' } },
      }]),
    ]);
    expect(openAi[0]?.role).toBe('user');
    const content = openAi[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts.some((p) => p.type === 'image_url' && p.image_url?.url === 'https://example.com/a.jpg')).toBe(true);
  });

  it('round-trips reasoning_content through agent message conversion', () => {
    const model = {
      id: 'deepseek-r1',
      provider: 'deepseek',
      api: 'openai-completions' as const,
      input: ['text'] as const,
      contextWindow: 128000,
      maxTokens: 4096,
    };
    const assistant = chatCompletionToAssistantMessage(
      {
        id: '1',
        object: 'chat.completion',
        created: 0,
        model: 'deepseek-r1',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: '结果是42。',
            reasoning_content: '让我一步步思考这个问题...',
          },
          finish_reason: 'stop',
        }],
      },
      model,
    );
    expect(assistant.content.some((b) => b.type === 'thinking')).toBe(true);
    const openAi = agentMessagesToOpenAi([assistant]);
    expect(openAi[0]?.reasoning_content).toBe('让我一步步思考这个问题...');
    expect(openAi[0]?.content).toBe('结果是42。');
  });

  it('preserves reasoning_content when model returns tool_calls without text', () => {
    const model = {
      id: 'deepseek-r1',
      provider: 'deepseek',
      api: 'openai-completions' as const,
      input: ['text'] as const,
      contextWindow: 128000,
      maxTokens: 4096,
    };
    const assistant = chatCompletionToAssistantMessage(
      {
        id: '1',
        object: 'chat.completion',
        created: 0,
        model: 'deepseek-r1',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            reasoning_content: '我需要搜索这个问题...',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'search', arguments: '{"q":"test"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      },
      model,
    );
    expect(assistant.content.some((b) => b.type === 'thinking')).toBe(true);
    const openAi = agentMessagesToOpenAi([assistant]);
    expect(openAi[0]?.reasoning_content).toBe('我需要搜索这个问题...');
    expect(openAi[0]?.tool_calls).toHaveLength(1);
  });

  it('promotes reasoning-only assistant message to text when content is null', () => {
    const model = {
      id: 'glm-test',
      provider: 'cloudflare',
      api: 'openai-completions' as const,
      input: ['text'] as const,
      contextWindow: 128000,
      maxTokens: 4096,
    };
    const assistant = chatCompletionToAssistantMessage(
      {
        id: '1',
        object: 'chat.completion',
        created: 0,
        model: 'glm-test',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null as unknown as string,
            reasoning_content: '你好！',
          },
          finish_reason: 'length',
        }],
      },
      model,
    );
    expect(assistantText(assistant)).toBe('你好！');
  });
});
