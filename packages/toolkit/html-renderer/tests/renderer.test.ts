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
  screenshotMock: vi.fn(async () => ({
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

vi.mock('@shotkit/shotium', () => ({
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
    startMock.mockClear();
    statusMock.mockReset();
    statusMock.mockReturnValue({ running: false });
    releaseMemoryMock.mockClear();
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

  it('downgrades svg requests to png with a warning', async () => {
    const warn = vi.fn();
    const renderer = createHtmlRenderer({ defaultWidth: 200 });
    const result = await renderer.render('<div>Hi</div>', { format: 'svg' });
    expect(result.format).toBe('png');
    expect(Buffer.isBuffer(result.data)).toBe(true);
    expect(screenshotMock).toHaveBeenCalledTimes(1);
    const rendererWithLogger = createHtmlRenderer({ defaultWidth: 200 }, { warn });
    await rendererWithLogger.render('<div>Hi</div>', { format: 'svg' });
    expect(warn).toHaveBeenCalledTimes(1);
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
