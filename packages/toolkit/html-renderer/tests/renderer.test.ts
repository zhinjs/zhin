import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5qkS0AAAAASUVORK5CYII=',
  'base64',
);

const {
  screenshotMock,
  startMock,
  statusMock,
  releaseMemoryMock,
  daemonConnectMock,
} = vi.hoisted(() => ({
  screenshotMock: vi.fn(async (..._args: unknown[]) => ({
    image: ONE_PIXEL_PNG,
    stats: {
      timing: { total: 1 },
      requests: 0,
      fromCache: 0,
      failed: 0,
    },
  })),
  startMock: vi.fn(() => ({ cacheActive: true, cacheDir: '/tmp/shotium-cache' })),
  statusMock: vi.fn(() => ({ running: false })),
  releaseMemoryMock: vi.fn(),
  daemonConnectMock: vi.fn(),
}));

vi.mock('@pixel.js/shotium', () => ({
  screenshot: screenshotMock,
  start: startMock,
  status: statusMock,
  releaseMemory: releaseMemoryMock,
  stop: vi.fn(),
  daemon: { connect: daemonConnectMock },
}));

import {
  createHtmlRenderer,
  type FontConfig,
} from '../src/index.js';
import { isFullDocument, wrapDocument } from '../src/html.js';
import { createEngine } from '../src/engine.js';
import { resolveHtmlRendererConfig } from '../src/config.js';

function makeFont(name: string, style?: FontConfig['style']): FontConfig {
  return { name, data: Buffer.from('font'), weight: 400, style };
}

describe('@zhin.js/html-renderer', () => {
  beforeEach(() => {
    screenshotMock.mockClear();
    screenshotMock.mockResolvedValue({
      image: ONE_PIXEL_PNG,
      stats: {
        timing: { total: 1 },
        requests: 0,
        fromCache: 0,
        failed: 0,
      },
    });
    startMock.mockReset();
    startMock.mockReturnValue({ cacheActive: true, cacheDir: '/tmp/shotium-cache' });
    statusMock.mockReset();
    statusMock.mockReturnValue({ running: false });
    releaseMemoryMock.mockClear();
    daemonConnectMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders simple html to png with shotium backend', async () => {
    const renderer = createHtmlRenderer({ defaultWidth: 200 });
    const result = await renderer.render('<div>Hi</div>', { format: 'png' });
    expect(result.format).toBe('png');
    expect(Buffer.isBuffer(result.data)).toBe(true);
    expect(screenshotMock).toHaveBeenCalledTimes(1);
  });

  it.each(['png', 'jpeg', 'webp'] as const)('renders the requested %s encoding', async (format) => {
    const renderer = createHtmlRenderer({ quality: 73 });
    const result = await renderer.render('<div>Hi</div>', { format });
    expect(result.format).toBe(format);
    expect(result.mimeType).toBe(`image/${format}`);
    expect(screenshotMock).toHaveBeenCalledWith(expect.objectContaining({ type: format }));
    expect(screenshotMock.mock.calls[0]![0]).toEqual(
      format === 'png'
        ? expect.not.objectContaining({ quality: expect.anything() })
        : expect.objectContaining({ quality: 73 }),
    );
  });

  it('uses the configured raster format when no per-render format is given', async () => {
    const result = await createHtmlRenderer({ type: 'webp' }).render('<div>Hi</div>');
    expect(result.format).toBe('webp');
    expect(result.mimeType).toBe('image/webp');
    expect(screenshotMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'webp' }));
  });

  it('rejects unsupported output instead of returning an unrelated encoding', async () => {
    // JS consumers can still send values outside the public TypeScript contract.
    const options = JSON.parse('{"format":"svg"}');
    await expect(createHtmlRenderer().render('<div>Hi</div>', options))
      .rejects.toThrow('Unsupported HTML image format: svg');
    expect(startMock).not.toHaveBeenCalled();
    expect(screenshotMock).not.toHaveBeenCalled();
  });

  it('does not swallow fixed process configuration mismatches', async () => {
    statusMock.mockReturnValue({ running: true });
    startMock.mockImplementationOnce(() => { throw new Error('cacheDir differs'); });
    await expect(createHtmlRenderer({ cacheDir: '/new-cache' }).render('<div>Hi</div>'))
      .rejects.toThrow('cacheDir differs');
    expect(screenshotMock).not.toHaveBeenCalled();
  });

  it('reuses the initialized engine and releases only reconstructible memory', async () => {
    const renderer = createHtmlRenderer({ cacheDir: 'off', userAgent: 'Zhin' });
    statusMock.mockReturnValue({ running: true });
    await renderer.render('<div>First</div>');
    await renderer.render('<div>Second</div>');
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith(expect.objectContaining({ cacheDir: null, userAgent: 'Zhin' }));
    expect(releaseMemoryMock).toHaveBeenCalledTimes(2);
  });

  it('releases the render slot after failed capture so later calls still complete', async () => {
    screenshotMock
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'));
    const renderer = createHtmlRenderer();
    await expect(renderer.render('<div>First</div>')).rejects.toThrow('first failure');
    await expect(renderer.render('<div>Second</div>')).rejects.toThrow('second failure');
    await expect(renderer.render('<div>Next</div>')).resolves.toMatchObject({ format: 'png' });
    expect(screenshotMock).toHaveBeenCalledTimes(3);
  });

  it('shares a daemon connection, reconnects after close, and disconnects on close', async () => {
    const callbacks: Array<() => void> = [];
    const close = vi.fn();
    const client = {
      screenshot: screenshotMock,
      once: vi.fn((_event: string, callback: () => void) => callbacks.push(callback)),
      close,
    };
    daemonConnectMock.mockResolvedValue(client);
    const engine = createEngine(resolveHtmlRendererConfig({ mode: 'daemon' }).shotium);
    await Promise.all([engine.screenshot({ file: 'a' }), engine.screenshot({ file: 'b' })]);
    expect(daemonConnectMock).toHaveBeenCalledTimes(1);
    callbacks[0]!();
    await engine.screenshot({ file: 'c' });
    expect(daemonConnectMock).toHaveBeenCalledTimes(2);
    await engine.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('throws when shotium rendering fails', async () => {
    screenshotMock.mockRejectedValueOnce(new Error('boom'));
    const renderer = createHtmlRenderer({ defaultWidth: 200 });
    await expect(renderer.render('<div>Hi</div>', { format: 'png' })).rejects.toThrow('boom');
  });

  it('accepts nested host-level htmlRenderer config', async () => {
    const renderer = createHtmlRenderer({ htmlRenderer: { width: 321, viewport: { height: 654 } } });
    await renderer.render('<div>Hi</div>');
    expect(screenshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: expect.objectContaining({ width: 321, height: 654 }),
      }),
    );
  });


});

describe('HTML document wrapping', () => {
  const options = {
    width: 800,
    backgroundColor: '#fff',
    fontFamily: 'sans-serif',
    fontFaces: '@font-face{font-family:test}',
  };

  it('recognizes full documents and injects fonts into head or body', () => {
    expect(isFullDocument('<!DOCTYPE html><html><head></head><body>x</body></html>')).toBe(true);
    expect(isFullDocument('<html-data>fragment</html-data>')).toBe(false);
    expect(wrapDocument('<HTML><HEAD></HEAD><BODY>x</BODY></HTML>', options)).toContain(
      '<style>@font-face{font-family:test}</style></HEAD>',
    );
    expect(wrapDocument('<html><body class="page">x</body></html>', options)).toContain(
      '<body class="page"><style>@font-face{font-family:test}</style>x',
    );
  });

  it('handles long attributes without regex backtracking', () => {
    const html = `<html><body data-value="${'x'.repeat(100_000)}">x</body></html>`;
    expect(wrapDocument(html, options)).toContain('<style>@font-face{font-family:test}</style>x');
  });
});

describe('fontCache', () => {
  it('同名同 weight 不同 style 的字体不互相覆盖', () => {
    const renderer = createHtmlRenderer();
    renderer.clearFonts();
    const before = renderer.getFonts().length;
    renderer.registerFont(makeFont('MyFont', 'normal'));
    renderer.registerFont(makeFont('MyFont', 'italic'));
    expect(renderer.getFonts().length).toBe(before + 2);
    renderer.clearFonts();
  });

  it('clearFonts 后 defaultFonts 不丢失', () => {
    const renderer = createHtmlRenderer({ defaultFonts: [makeFont('CfgFont')] });
    expect(renderer.getFonts().some((f) => f.name === 'CfgFont')).toBe(true);
    renderer.clearFonts();
    expect(renderer.getFonts().some((f) => f.name === 'CfgFont')).toBe(true);
  });
});
