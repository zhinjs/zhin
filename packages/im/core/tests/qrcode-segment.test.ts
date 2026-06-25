import { describe, it, expect, vi } from 'vitest';
import { segment } from '../src/utils.js';
import {
  qrcodeSegment,
  resolveQrcodeSegmentsToImages,
  resolveQrcodeSegmentsToTerminal,
  coerceQrcodeSegmentsToText,
} from '../src/built/qrcode-segment.js';
import { GeneratedQrCode } from '../src/built/generated-qrcode.js';

describe('qrcode segment', () => {
  it('segment.qrcode creates qrcode element', () => {
    const el = segment.qrcode('https://example.com');
    expect(el.type).toBe('qrcode');
    expect(el.data.text).toBe('https://example.com');
  });

  it('qrcodeSegment alias matches segment.qrcode', () => {
    expect(qrcodeSegment('abc').type).toBe('qrcode');
  });

  it('resolveQrcodeSegmentsToImages converts to image', async () => {
    const resolved = await resolveQrcodeSegmentsToImages([
      segment.qrcode('https://bind.example'),
      segment.text('scan me'),
    ]);
    const items = Array.isArray(resolved) ? resolved : [resolved];
    expect(items[0]?.type).toBe('image');
    expect(String(items[0]?.data?.url ?? '')).toMatch(/^data:image\/png;base64,/);
    expect(items[1]?.type).toBe('text');
  });

  it('resolveQrcodeSegmentsToTerminal prints to terminal', async () => {
    const printSpy = vi.spyOn(GeneratedQrCode.prototype, 'printToTerminal').mockResolvedValue();
    const resolved = await resolveQrcodeSegmentsToTerminal(segment.qrcode('hello-process'));
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
    const text = typeof resolved === 'string'
      ? resolved
      : resolved?.type === 'text'
        ? resolved.data.text
        : '';
    expect(String(text)).toContain('[二维码]');
  });

  it('coerceQrcodeSegmentsToText fallback', () => {
    const out = coerceQrcodeSegmentsToText(segment.qrcode('fallback-url'));
    expect(out).toMatchObject({ type: 'text', data: { text: '[二维码] fallback-url' } });
  });
});

describe('segment.raw qrcode', () => {
  it('includes qrcode preview', () => {
    expect(segment.raw(segment.qrcode('https://q.qq.com/x'))).toContain('[qrcode]');
  });
});
