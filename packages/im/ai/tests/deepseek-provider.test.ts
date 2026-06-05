import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DeepSeekProvider } from '../src/providers/deepseek.js';
import type { ChatCompletionRequest } from '../src/types.js';

function bodyFor(
  provider: DeepSeekProvider,
  request: ChatCompletionRequest,
): Record<string, unknown> {
  return (provider as unknown as { buildRequestBody(req: ChatCompletionRequest): Record<string, unknown> })
    .buildRequestBody(request);
}

describe('DeepSeekProvider', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('listModels 应请求 GET /models 并同步 provider.models', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          object: 'list',
          data: [
            { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' },
            { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek' },
          ],
        }),
      text: () => Promise.resolve(''),
    } as Response);

    const provider = new DeepSeekProvider({ apiKey: 'sk-test' });
    const ids = await provider.listModels();

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/models');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer sk-test',
    });
    expect(ids).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
    expect(provider.models).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
  });

  it('listModels API 失败时回退静态列表', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    const provider = new DeepSeekProvider({ apiKey: 'sk-test' });
    const ids = await provider.listModels();

    expect(ids).toContain('deepseek-v4-flash');
    expect(ids).toContain('deepseek-v4-pro');
  });

  it('默认 baseUrl 为官方端点（无 /v1）', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test' });
    expect((provider as unknown as { baseUrl: string }).baseUrl).toBe('https://api.deepseek.com');
  });

  it('strictTools 时使用 beta 端点', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test', strictTools: true });
    expect((provider as unknown as { baseUrl: string }).baseUrl).toBe('https://api.deepseek.com/beta');
  });

  it('v4-flash 默认不开启 thinking', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test' });
    const body = bodyFor(provider, {
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('reasoner / think:true / v4-pro 开启 thinking', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test', reasoningEffort: 'high' });

    for (const model of ['deepseek-reasoner', 'deepseek-v4-pro']) {
      const body = bodyFor(provider, {
        model,
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(body.thinking).toEqual({ type: 'enabled' });
      expect(body.reasoning_effort).toBe('high');
    }

    const explicit = bodyFor(provider, {
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hi' }],
      think: true,
    });
    expect(explicit.thinking).toEqual({ type: 'enabled' });
  });

  it('无 vision 时应将 image_url 压平为纯文本 content', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test' });
    const body = bodyFor(provider, {
      model: 'deepseek-v4-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '看图' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          ],
        },
      ],
    });
    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0].content).toBe('看图\n[图片]');
    expect(typeof messages[0].content).toBe('string');
  });

  it('think:false 时关闭 thinking（工具轮次）', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test' });
    const body = bodyFor(provider, {
      model: 'deepseek-reasoner',
      messages: [{ role: 'user', content: 'hi' }],
      think: false,
    });
    expect(body.thinking).toBeUndefined();
  });

  it('保留 assistant 消息中的 reasoning_content', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test' });
    const body = bodyFor(provider, {
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'c1',
            type: 'function',
            function: { name: 't', arguments: '{}' },
          }],
          reasoning_content: 'chain-of-thought',
        },
        { role: 'tool', content: 'ok', tool_call_id: 'c1' },
      ],
      tools: [{
        type: 'function',
        function: { name: 't', description: 'd', parameters: { type: 'object', properties: {} } },
      }],
    });
    const messages = body.messages as { reasoning_content?: string }[];
    const assistant = messages.find(m => m.reasoning_content);
    expect(assistant?.reasoning_content).toBe('chain-of-thought');
  });
});
