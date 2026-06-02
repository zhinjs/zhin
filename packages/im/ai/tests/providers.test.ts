/**
 * @zhin.js/ai - AI Providers Test
 * Tests for OpenAI and Anthropic providers with mocked fetch
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../src/providers/openai.js';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import type {
  AIProvider,
  ChatCompletionRequest,
} from '../src/types.js';

/** Helper to create a ReadableStream from SSE lines */
function createSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const text = lines.join('\n') + '\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

/** Collect all chunks from an async iterable */
async function collectChunks<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const chunks: T[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('AI Providers', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('AIProvider interface', () => {
    it('OpenAIProvider implements AIProvider interface', () => {
      const provider = new OpenAIProvider({ apiKey: 'test' });
      expect(provider).toHaveProperty('name', 'openai');
      expect(provider).toHaveProperty('models');
      expect(Array.isArray(provider.models)).toBe(true);
      expect(typeof provider.chat).toBe('function');
      expect(typeof provider.chatStream).toBe('function');
      expect(provider).toMatchObject({
        name: 'openai',
        capabilities: expect.objectContaining({
          vision: true,
          streaming: true,
          toolCalling: true,
        }),
      } as Partial<AIProvider>);
    });

    it('AnthropicProvider implements AIProvider interface', () => {
      const provider = new AnthropicProvider({ apiKey: 'test' });
      expect(provider).toHaveProperty('name', 'anthropic');
      expect(provider).toHaveProperty('models');
      expect(Array.isArray(provider.models)).toBe(true);
      expect(typeof provider.chat).toBe('function');
      expect(typeof provider.chatStream).toBe('function');
      expect(provider).toMatchObject({
        name: 'anthropic',
        capabilities: expect.objectContaining({
          vision: true,
          streaming: true,
          toolCalling: true,
        }),
      } as Partial<AIProvider>);
    });
  });

  describe('OpenAIProvider', () => {
    describe('constructor', () => {
      it('should set name, apiKey, baseUrl, models', () => {
        const provider = new OpenAIProvider({
          apiKey: 'sk-test-key',
          baseUrl: 'https://custom.api.com/v1',
        });
        expect(provider.name).toBe('openai');
        expect(provider.models).toContain('gpt-4o');
        expect(provider.models).toContain('gpt-3.5-turbo');
        expect((provider as any).baseUrl).toBe('https://custom.api.com/v1');
      });

      it('should use default baseUrl when not provided', () => {
        const provider = new OpenAIProvider({ apiKey: 'sk-test' });
        expect((provider as any).baseUrl).toBe('https://api.openai.com/v1');
      });

      it('should use custom models when provided', () => {
        const customModels = ['custom-model-1', 'custom-model-2'];
        const provider = new OpenAIProvider({
          apiKey: 'sk-test',
          models: customModels,
        });
        expect(provider.models).toEqual(customModels);
      });

      it('should not override models when empty array provided', () => {
        const provider = new OpenAIProvider({
          apiKey: 'sk-test',
          models: [],
        });
        expect(provider.models).toEqual([
          'gpt-4o',
          'gpt-4o-mini',
          'gpt-4-turbo',
          'gpt-4',
          'gpt-3.5-turbo',
          'o1',
          'o1-mini',
          'o1-preview',
          'o3-mini',
        ]);
      });
    });

    describe('chat()', () => {
      it('should return ChatCompletionResponse when fetch succeeds', async () => {
        const mockResponse = {
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1234567890,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Hello!',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        };

        fetchSpy.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockResponse),
          text: () => Promise.resolve(''),
        } as Response);

        const provider = new OpenAIProvider({ apiKey: 'sk-test' });
        const request: ChatCompletionRequest = {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi' }],
        };

        const result = await provider.chat(request);

        expect(result).toEqual(mockResponse);
        expect(result.choices[0].message.content).toBe('Hello!');
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.stringContaining('/chat/completions'),
          expect.objectContaining({
            method: 'POST',
          })
        );
      });
    });

    describe('chatStream()', () => {
      it('should yield correct chunks from streaming response', async () => {
        const chunk1 = JSON.stringify({
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1234567890,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: { content: 'Hello' },
              finish_reason: null,
            },
          ],
        });
        const chunk2 = JSON.stringify({
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1234567890,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: { content: ' world!' },
              finish_reason: null,
            },
          ],
        });
        const chunk3 = JSON.stringify({
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1234567890,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
            },
          ],
        });

        const sseLines = [
          'data: ' + chunk1,
          'data: ' + chunk2,
          'data: ' + chunk3,
        ];

        fetchSpy.mockResolvedValueOnce({
          ok: true,
          body: createSSEStream(sseLines),
          text: () => Promise.resolve(''),
        } as Response);

        const provider = new OpenAIProvider({ apiKey: 'sk-test' });
        const request: ChatCompletionRequest = {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi' }],
        };

        const chunks = await collectChunks(provider.chatStream(request));

        expect(chunks).toHaveLength(3);
        expect(chunks[0].choices[0].delta.content).toBe('Hello');
        expect(chunks[1].choices[0].delta.content).toBe(' world!');
        expect(chunks[2].choices[0].finish_reason).toBe('stop');
      });

      it('should yield tool call chunks correctly', async () => {
        const toolCallChunk = JSON.stringify({
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1234567890,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_abc',
                    type: 'function',
                    function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        const finishChunk = JSON.stringify({
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1234567890,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'tool_calls',
            },
          ],
        });

        const sseLines = ['data: ' + toolCallChunk, 'data: ' + finishChunk];

        fetchSpy.mockResolvedValueOnce({
          ok: true,
          body: createSSEStream(sseLines),
          text: () => Promise.resolve(''),
        } as Response);

        const provider = new OpenAIProvider({ apiKey: 'sk-test' });
        const request: ChatCompletionRequest = {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_weather',
                description: 'Get weather',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
        };

        const chunks = await collectChunks(provider.chatStream(request));

        expect(chunks).toHaveLength(2);
        expect(chunks[0].choices[0].delta.tool_calls).toBeDefined();
        expect(chunks[0].choices[0].delta.tool_calls![0]).toMatchObject({
          id: 'call_abc',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
        });
        expect(chunks[1].choices[0].finish_reason).toBe('tool_calls');
      });

      it('should throw when fetch returns 4xx', async () => {
        fetchSpy.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: () => Promise.resolve('Invalid API key'),
        } as Response);

        const provider = new OpenAIProvider({ apiKey: 'sk-invalid' });
        const request: ChatCompletionRequest = {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi' }],
        };

        await expect(
          collectChunks(provider.chatStream(request))
        ).rejects.toThrow(/API Error \(401\)/);
      });

      it('should throw when fetch returns 5xx', async () => {
        fetchSpy.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error'),
        } as Response);

        const provider = new OpenAIProvider({ apiKey: 'sk-test' });
        const request: ChatCompletionRequest = {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi' }],
        };

        await expect(
          collectChunks(provider.chatStream(request))
        ).rejects.toThrow(/API Error \(500\)/);
      });
    });

    describe('chat() error handling', () => {
      it('should throw when fetch returns 4xx', async () => {
        fetchSpy.mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: () => Promise.resolve('Rate limit exceeded'),
        } as Response);

        const provider = new OpenAIProvider({ apiKey: 'sk-test' });
        const request: ChatCompletionRequest = {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi' }],
        };

        await expect(provider.chat(request)).rejects.toThrow(/API Error \(429\)/);
      });

      it('should throw when fetch returns 5xx', async () => {
        fetchSpy.mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: () => Promise.resolve('Service Unavailable'),
        } as Response);

        const provider = new OpenAIProvider({ apiKey: 'sk-test' });
        const request: ChatCompletionRequest = {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi' }],
        };

        await expect(provider.chat(request)).rejects.toThrow(/API Error \(503\)/);
      });
    });

    describe('healthCheck()', () => {
      it('should return true when listModels fetch succeeds', async () => {
        fetchSpy.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5-turbo' }],
            }),
          text: () => Promise.resolve(''),
        } as Response);

        const provider = new OpenAIProvider({ apiKey: 'sk-test' });
        const result = await provider.healthCheck!();

        expect(result).toBe(true);
      });

      it('should return true when fetch fails (listModels catches and returns default models)', async () => {
        fetchSpy.mockRejectedValueOnce(new Error('Network error'));

        const provider = new OpenAIProvider({ apiKey: 'sk-test' });
        const result = await provider.healthCheck!();

        expect(result).toBe(true);
      });
    });
  });

  describe('AnthropicProvider', () => {
    describe('constructor', () => {
      it('should set name and apiKey', () => {
        const provider = new AnthropicProvider({
          apiKey: 'sk-ant-test-key',
        });
        expect(provider.name).toBe('anthropic');
        expect(provider.models).toContain('claude-3-5-sonnet-20241022');
      });

      it('should use custom models when provided', () => {
        const customModels = ['claude-custom-1'];
        const provider = new AnthropicProvider({
          apiKey: 'sk-ant-test',
          models: customModels,
        });
        expect(provider.models).toEqual(customModels);
      });
    });

    describe('chat()', () => {
      it('should return ChatCompletionResponse in OpenAI format', async () => {
        const anthropicResponse = {
          id: 'msg_123',
          model: 'claude-3-5-sonnet-20241022',
          content: [{ type: 'text', text: 'Hello from Claude!' }],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
          },
        };

        fetchSpy.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(anthropicResponse),
          text: () => Promise.resolve(''),
        } as Response);

        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' });
        const request: ChatCompletionRequest = {
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Hi' }],
        };

        const result = await provider.chat(request);

        expect(result.object).toBe('chat.completion');
        expect(result.choices[0].message.content).toBe('Hello from Claude!');
        expect(result.choices[0].finish_reason).toBe('stop');
        expect(result.usage?.total_tokens).toBe(15);
      });
    });

    describe('chatStream()', () => {
      it('should yield chunks from Anthropic SSE format (content_block_delta)', async () => {
        const sseLines = [
          'data: ' +
            JSON.stringify({
              type: 'message_start',
              message: { id: 'msg_123', model: 'claude-3-5-sonnet' },
            }),
          'data: ' +
            JSON.stringify({
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'Hello' },
            }),
          'data: ' +
            JSON.stringify({
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: ' world!' },
            }),
          'data: ' +
            JSON.stringify({
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
            }),
        ];

        fetchSpy.mockResolvedValueOnce({
          ok: true,
          body: createSSEStream(sseLines),
          text: () => Promise.resolve(''),
        } as Response);

        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' });
        const request: ChatCompletionRequest = {
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Hi' }],
        };

        const chunks = await collectChunks(provider.chatStream(request));

        expect(chunks).toHaveLength(3);
        expect(chunks[0].choices[0].delta.content).toBe('Hello');
        expect(chunks[1].choices[0].delta.content).toBe(' world!');
        expect(chunks[2].choices[0].finish_reason).toBe('stop');
      });

      it('should yield tool_calls finish_reason when stop_reason is tool_use', async () => {
        const sseLines = [
          'data: ' +
            JSON.stringify({
              type: 'message_start',
              message: { id: 'msg_456', model: 'claude-3-5-sonnet' },
            }),
          'data: ' +
            JSON.stringify({
              type: 'message_delta',
              delta: { stop_reason: 'tool_use' },
            }),
        ];

        fetchSpy.mockResolvedValueOnce({
          ok: true,
          body: createSSEStream(sseLines),
          text: () => Promise.resolve(''),
        } as Response);

        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' });
        const request: ChatCompletionRequest = {
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Use a tool' }],
        };

        const chunks = await collectChunks(provider.chatStream(request));

        expect(chunks).toHaveLength(1);
        expect(chunks[0].choices[0].finish_reason).toBe('tool_calls');
      });

      it('should throw when fetch returns error', async () => {
        fetchSpy.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: () => Promise.resolve('Invalid API key'),
        } as Response);

        const provider = new AnthropicProvider({ apiKey: 'sk-invalid' });
        const request: ChatCompletionRequest = {
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Hi' }],
        };

        await expect(
          collectChunks(provider.chatStream(request))
        ).rejects.toThrow(/Anthropic API Error \(401\)/);
      });
    });

    describe('healthCheck()', () => {
      it('should return true when listModels succeeds', async () => {
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' });
        const result = await provider.healthCheck!();

        expect(result).toBe(true);
      });
    });
  });
});
