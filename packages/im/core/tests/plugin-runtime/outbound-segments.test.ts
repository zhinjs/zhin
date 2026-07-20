import { describe, expect, it } from 'vitest';
import type { HtmlRendererHost } from '@zhin.js/plugin-runtime';
import { normalizeOutboundPayload } from '../../src/plugin-runtime/im/outbound-segments.js';

function mockRenderer(result?: Partial<Awaited<ReturnType<HtmlRendererHost['render']>>>): HtmlRendererHost {
  return {
    async render(html, options) {
      return {
        data: Buffer.from(`png:${html}:${options?.width ?? 0}`),
        format: 'png',
        width: options?.width ?? 800,
        height: 200,
        mimeType: 'image/png',
        ...result,
      };
    },
  };
}

describe('normalizeOutboundPayload', () => {
  it('wraps a single segment object into a one-element array', async () => {
    const segment = { type: 'text', data: { text: 'hi' } };
    expect(await normalizeOutboundPayload(segment)).toEqual([segment]);
  });

  it('renders html segments to image segments when a renderer is available', async () => {
    const payload = await normalizeOutboundPayload(
      { type: 'html', data: { html: '<b>hi</b>', width: 400, fileName: 'zt.png' } },
      mockRenderer(),
    );
    expect(payload).toEqual([{
      type: 'image',
      data: {
        base64: Buffer.from('png:<b>hi</b>:400').toString('base64'),
        name: 'zt.png',
      },
    }]);
  });

  it('renders html segments inside arrays, keeping other elements untouched', async () => {
    const payload = await normalizeOutboundPayload(
      [
        'plain',
        { type: 'at', data: { qq: '2' } },
        { type: 'html', data: { html: '<i>x</i>' } },
      ],
      mockRenderer(),
    );
    expect(payload).toEqual([
      'plain',
      { type: 'at', data: { qq: '2' } },
      {
        type: 'image',
        data: {
          base64: Buffer.from('png:<i>x</i>:540').toString('base64'),
          name: 'card.png',
        },
      },
    ]);
  });

  it('falls back to the segment text when no renderer is available', async () => {
    const payload = await normalizeOutboundPayload({
      type: 'html',
      data: { html: '<b>hi</b>', text: 'fallback-text' },
    });
    expect(payload).toEqual([{ type: 'text', data: { text: 'fallback-text' } }]);
  });

  it('derives fallback text from html when no renderer is available', async () => {
    const payload = await normalizeOutboundPayload({
      type: 'html',
      data: { html: '<h1>Title</h1><p>body<br>line</p>' },
    });
    expect(payload).toEqual([{ type: 'text', data: { text: '# Title\n\n body\nline' } }]);
  });

  it('falls back to text when rendering throws', async () => {
    const renderer: HtmlRendererHost = {
      async render() { throw new Error('render failed'); },
    };
    const payload = await normalizeOutboundPayload(
      { type: 'html', data: { html: '<b>hi</b>', text: 'oops' } },
      renderer,
    );
    expect(payload).toEqual([{ type: 'text', data: { text: 'oops' } }]);
  });

  it('falls back to text when the render result is not a png buffer', async () => {
    const payload = await normalizeOutboundPayload(
      { type: 'html', data: { html: '<b>hi</b>' } },
      mockRenderer({ data: '<svg/>', format: 'svg', mimeType: 'image/svg+xml' }),
    );
    expect(payload).toEqual([{ type: 'text', data: { text: 'hi' } }]);
  });

  it('passes non-segment payloads through untouched', async () => {
    expect(await normalizeOutboundPayload('hello')).toBe('hello');
    expect(await normalizeOutboundPayload({ text: 'legacy', hooked: true }))
      .toEqual({ text: 'legacy', hooked: true });
    expect(await normalizeOutboundPayload(null)).toBeNull();
  });
});
