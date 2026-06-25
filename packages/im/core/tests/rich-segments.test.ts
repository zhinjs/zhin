import { describe, expect, it, vi } from 'vitest';
import { segment } from '../src/utils.js';
import {
  HtmlSegment,
  MarkdownSegment,
  QrcodeSegment,
  TtsSegment,
  markdownToPlainText,
  resolveRichSegments,
  DEFAULT_OUTBOUND_RICH_SEGMENT_POLICY,
} from '../src/built/rich-segments/index.js';
import { GeneratedQrCode } from '../src/built/generated-qrcode.js';

describe('RichSegment classes', () => {
  describe('QrcodeSegment', () => {
    it('render(image) produces image segment', async () => {
      const qr = new QrcodeSegment({ text: 'https://example.com' });
      const out = await qr.render('image');
      expect(out).toMatchObject({ type: 'image' });
      expect(String((out as { data: { url?: string } }).data.url)).toMatch(/^data:image\/png;base64,/);
    });

    it('render(text) produces placeholder text', async () => {
      const out = await new QrcodeSegment({ text: 'abc' }).render('text');
      expect(out).toMatchObject({ type: 'text', data: { text: '[二维码] abc' } });
    });

    it('render(origin) preserves qrcode segment', async () => {
      const out = await new QrcodeSegment({ text: 'keep' }).render('origin');
      expect(out).toMatchObject({ type: 'qrcode', data: { text: 'keep' } });
    });
  });

  describe('HtmlSegment', () => {
    it('render(text) strips html', async () => {
      const out = await new HtmlSegment({ html: '<div>Hello</div>' }).render('text');
      expect((out as { data: { text: string } }).data.text).toContain('Hello');
    });

    it('render(origin) preserves html segment', async () => {
      const out = await new HtmlSegment({ html: '<div>x</div>' }).render('origin');
      expect(out).toMatchObject({ type: 'html' });
    });

    it('render(image) without renderer falls back to text', async () => {
      const out = await new HtmlSegment({ html: '<div>card</div>' }).render('image');
      expect(out).toMatchObject({ type: 'text' });
    });

    it('render(image) uses html-renderer when available', async () => {
      const render = vi.fn().mockResolvedValue({
        format: 'png',
        data: Buffer.from('png-bytes'),
      });
      const out = await new HtmlSegment({ html: '<div>card</div>' }).render('image', {
        resolveCapability: async () => ({ render }),
      });
      expect(render).toHaveBeenCalled();
      expect(out).toMatchObject({ type: 'image' });
    });
  });

  describe('MarkdownSegment', () => {
    it('render(text) strips markdown syntax', async () => {
      const out = await new MarkdownSegment({ content: '**bold** text' }).render('text');
      expect((out as { data: { text: string } }).data.text).toBe('bold text');
    });

    it('render(origin) preserves markdown segment', async () => {
      const out = await new MarkdownSegment({ content: '# title' }).render('origin');
      expect(out).toMatchObject({ type: 'markdown', data: { content: '# title' } });
    });
  });

  describe('TtsSegment', () => {
    it('render(text) returns plain text', async () => {
      const out = await new TtsSegment({ text: 'hello' }).render('text');
      expect(out).toMatchObject({ type: 'text', data: { text: 'hello' } });
    });

    it('render(origin) preserves tts segment', async () => {
      const out = await new TtsSegment({ text: 'say' }).render('origin');
      expect(out).toMatchObject({ type: 'tts', data: { text: 'say' } });
    });

    it('render(audio) without speech falls back to text', async () => {
      const out = await new TtsSegment({ text: 'hello' }).render('audio');
      expect(out).toMatchObject({ type: 'text', data: { text: 'hello' } });
    });

    it('render(audio) uses speech capability when available', async () => {
      const synthesize = vi.fn().mockResolvedValue({
        data: Buffer.from('mp3'),
        format: 'mp3',
      });
      const out = await new TtsSegment({ text: 'hello' }).render('audio', {
        resolveCapability: async () => ({ synthesize }),
      });
      expect(synthesize).toHaveBeenCalledWith({ text: 'hello', voice: undefined, provider: undefined });
      expect(out).toMatchObject({ type: 'audio' });
    });
  });
});

describe('resolveRichSegments', () => {
  it('applies default policy (qrcode image, html text)', async () => {
    const resolved = await resolveRichSegments(
      [segment.qrcode('url'), segment.html({ html: '<div>Hi</div>' })],
      DEFAULT_OUTBOUND_RICH_SEGMENT_POLICY,
    );
    const items = Array.isArray(resolved) ? resolved : [resolved];
    expect(items[0]?.type).toBe('image');
    expect(items[1]?.type).toBe('text');
  });

  it('wraps plain segment objects without class instances', async () => {
    const resolved = await resolveRichSegments(
      [{ type: 'qrcode', data: { text: 'plain' } }],
      DEFAULT_OUTBOUND_RICH_SEGMENT_POLICY,
    );
    const item = Array.isArray(resolved) ? resolved[0] : resolved;
    expect(item?.type).toBe('image');
  });

  it('qq policy keeps markdown origin', async () => {
    const resolved = await resolveRichSegments(
      segment.markdown('# Hello'),
      { qrcode: 'image', html: 'image', markdown: 'origin' },
    );
    const item = Array.isArray(resolved) ? resolved[0] : resolved;
    expect(item).toMatchObject({ type: 'markdown', data: { content: '# Hello' } });
  });

  it('process policy keeps qrcode origin', async () => {
    const resolved = await resolveRichSegments(
      segment.qrcode('proc'),
      { qrcode: 'origin', html: 'text', markdown: 'text' },
    );
    const item = Array.isArray(resolved) ? resolved[0] : resolved;
    expect(item).toMatchObject({ type: 'qrcode', data: { text: 'proc' } });
  });
});

describe('markdownToPlainText', () => {
  it('strips common markdown', () => {
    expect(markdownToPlainText('**a** [link](https://x.com)')).toBe('a link');
  });
});

describe('segment factories return RichSegment instances', () => {
  it('segment.qrcode/html/markdown/tts', () => {
    expect(segment.qrcode('x')).toBeInstanceOf(QrcodeSegment);
    expect(segment.html({ html: '<p/>' })).toBeInstanceOf(HtmlSegment);
    expect(segment.markdown('md')).toBeInstanceOf(MarkdownSegment);
    expect(segment.tts({ text: 'hi' })).toBeInstanceOf(TtsSegment);
  });
});

describe('richSegmentRegistry extension', () => {
  it('registers custom kind and resolves policy mode', async () => {
    const {
      RichSegment,
      registerRichSegmentKind,
      richSegmentRegistry,
      resetBuiltinRichSegmentKindsForTests,
      resolveRichSegments,
      RICH_SEGMENT_MODE,
    } = await import('../src/built/rich-segments/index.js');

    resetBuiltinRichSegmentKindsForTests();

    class EchoSegment extends RichSegment<{ label: string }> {
      readonly segmentType = 'echo';
      async render(mode: string) {
        if (mode === RICH_SEGMENT_MODE.ORIGIN) return this.toJSON();
        return segment.text(`[echo:${mode}] ${this.data.label}`);
      }
    }

    registerRichSegmentKind({
      kind: 'echo',
      defaultMode: RICH_SEGMENT_MODE.TEXT,
      modes: [RICH_SEGMENT_MODE.ORIGIN, RICH_SEGMENT_MODE.TEXT, 'shout'],
      wrap: (data) => new EchoSegment({ label: String(data.label ?? '') }),
    });

    const resolved = await resolveRichSegments(
      { type: 'echo', data: { label: 'hi' } },
      { echo: 'shout' },
    );
    expect(resolved).toMatchObject({ type: 'text', data: { text: '[echo:shout] hi' } });
    expect(richSegmentRegistry.has('echo')).toBe(true);

    resetBuiltinRichSegmentKindsForTests();
  });

  it('falls back to kind defaultMode for invalid policy mode', async () => {
    const { resolveRichSegments, DEFAULT_OUTBOUND_RICH_SEGMENT_POLICY } = await import(
      '../src/built/rich-segments/index.js',
    );
    const resolved = await resolveRichSegments(
      segment.qrcode('x'),
      { ...DEFAULT_OUTBOUND_RICH_SEGMENT_POLICY, qrcode: 'not-a-mode' },
    );
    const item = Array.isArray(resolved) ? resolved[0] : resolved;
    expect(item?.type).toBe('image');
  });
});

describe('interpretOriginQrcodeForProcess', () => {
  it('prints and replaces qrcode with text', async () => {
    const { interpretOriginQrcodeForProcess } = await import('../src/built/rich-segments/qrcode-segment.js');
    const printSpy = vi.spyOn(GeneratedQrCode.prototype, 'printToTerminal').mockResolvedValue();
    const out = await interpretOriginQrcodeForProcess(segment.qrcode('term'));
    printSpy.mockRestore();
    expect(out).toMatchObject({ type: 'text', data: { text: '[二维码] term' } });
  });
});
