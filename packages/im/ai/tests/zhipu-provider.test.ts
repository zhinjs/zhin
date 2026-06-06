import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ZhipuProvider } from '../src/providers/openai.js';

describe('ZhipuProvider', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('listModels 应请求 GET /models（OpenAI 兼容）', async () => {
    fetchSpy.mockResolvedValueOnce({
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
    } as Response);

    const provider = new ZhipuProvider({ apiKey: 'sk-test' });
    const ids = await provider.listModels();

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://open.bigmodel.cn/api/paas/v4/models');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer sk-test',
    });
    expect(ids).toEqual(['glm-4-flash', 'glm-4.6v']);
  });

  it('listModels API 失败时回退静态列表', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    const provider = new ZhipuProvider({ apiKey: 'sk-test' });
    const ids = await provider.listModels();

    expect(ids).toContain('glm-4-flash');
    expect(ids).toContain('glm-4.6v');
  });
});
