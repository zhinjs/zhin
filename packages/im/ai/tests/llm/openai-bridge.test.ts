import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  agentMessagesToOpenAi,
  contextToChatCompletionRequest,
  chatCompletionToAssistantMessage,
  createContext,
  createUserMessage,
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
    expect(openAi).toHaveLength(2);
    expect(openAi[1]?.role).toBe('tool');
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
      createUserMessage('see', [{ type: 'image', data: 'https://example.com/a.jpg', mimeType: 'image/jpeg' }]),
    ]);
    expect(openAi[0]?.role).toBe('user');
    const content = openAi[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts.some((p) => p.type === 'image_url' && p.image_url?.url === 'https://example.com/a.jpg')).toBe(true);
  });
});
