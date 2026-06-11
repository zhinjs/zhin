import { describe, expect, it, vi } from 'vitest';
import { segment, type SendOptions } from 'zhin.js';
import { registerHtmlCardOutbound } from '../src/html-card-outbound.js';

describe('registerHtmlCardOutbound', () => {
  it('将 html 段转为 image 段', async () => {
    const handlers: Array<(o: SendOptions) => unknown> = [];
    const root = {
      on: (_ev: 'before.sendMessage', fn: (o: SendOptions) => unknown) => {
        handlers.push(fn);
      },
      off: vi.fn(),
    };
    const png = Buffer.from('png-bytes');
    const render = vi.fn().mockResolvedValue({ format: 'png', data: png });
    registerHtmlCardOutbound({
      root,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      fullConfig: { cardOutbound: true },
      getRenderer: () => ({ render } as never),
    });

    expect(handlers).toHaveLength(1);
    const result = (await handlers[0]!({
      context: 'icqq',
      endpoint: '1',
      type: 'private',
      id: 'u1',
      content: segment.html({ html: '<div>card</div>', fileName: 'stats.png' }),
    })) as SendOptions;

    const item = Array.isArray(result.content) ? result.content[0] : result.content;
    expect(item).toMatchObject({ type: 'image' });
    expect((item as { data: { url: string; name: string } }).data.name).toBe('stats.png');
    expect((item as { data: { url: string } }).data.url).toMatch(/^base64:\/\//);
    expect(render).toHaveBeenCalledOnce();
  });

  it('cardOutbound 关闭时跳过注册', () => {
    const handlers: Array<(o: SendOptions) => unknown> = [];
    const root = {
      on: (_ev: 'before.sendMessage', fn: (o: SendOptions) => unknown) => {
        handlers.push(fn);
      },
    };
    const dispose = registerHtmlCardOutbound({
      root,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      fullConfig: { cardOutbound: false },
      getRenderer: () => ({ render: vi.fn() } as never),
    });
    expect(dispose).toBeUndefined();
    expect(handlers).toHaveLength(0);
  });

  it('渲染失败时保留 html 段', async () => {
    const handlers: Array<(o: SendOptions) => unknown> = [];
    const root = { on: (_ev: 'before.sendMessage', fn: (o: SendOptions) => unknown) => handlers.push(fn) };
    registerHtmlCardOutbound({
      root,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      fullConfig: { cardOutbound: true },
      getRenderer: () => ({ render: vi.fn().mockRejectedValue(new Error('boom')) } as never),
    });

    const input = segment.html({ html: '<div>keep</div>' });
    const result = (await handlers[0]!({
      context: 'icqq',
      endpoint: '1',
      type: 'private',
      id: 'u1',
      content: input,
    })) as SendOptions;

    expect(result.content).toEqual(input);
  });
});
