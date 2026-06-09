import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ZhipuProvider } from '../src/providers/openai.js';

type FetchSpy = ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;

function stubFetchForUrl(
  fetchSpy: FetchSpy,
  url: string,
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
): void {
  fetchSpy.mockImplementation(async (input, init) => {
    if (String(input) === url) {
      return handler(input, init);
    }
    return new Response('{}', { status: 200 });
  });
}

describe('ZhipuProvider', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('listModels 应请求 GET /models（OpenAI 兼容）', async () => {
    stubFetchForUrl(fetchSpy, 'https://open.bigmodel.cn/api/paas/v4/models', () => ({
      ok: true,
      json: () =>
        Promise.resolve({
          object: 'list',
          data: [
            { id: 'glm-4-flash', object: 'model' },
            { id: 'glm-4.6v', object: 'model' },
          ],
        }),
      text: () => Promise.resolve(''),
    } as Response));

    const provider = new ZhipuProvider({ apiKey: 'sk-test' });
    const ids = await provider.listModels();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/paas/v4/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
        }),
      }),
    );
    expect(ids).toEqual(['glm-4-flash', 'glm-4.6v']);
  });

  it('listModels API 失败时回退静态列表', async () => {
    stubFetchForUrl(fetchSpy, 'https://open.bigmodel.cn/api/paas/v4/models', () => {
      throw new Error('Network error');
    });

    const provider = new ZhipuProvider({ apiKey: 'sk-test' });
    const ids = await provider.listModels();

    expect(ids).toContain('glm-4-flash');
    expect(ids).toContain('glm-4.6v');
  });
});
