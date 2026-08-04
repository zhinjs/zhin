import { describe, expect, it } from 'vitest';
import {
  assertCanonicalSegments,
  isCanonicalSegment,
  isMediaRef,
  segmentsForImDelivery,
  collectSegmentMedia,
  textSegmentSchema,
  mentionSegmentSchema,
} from '../src/built/segment-contract/index.js';
import { toCanonicalSegments } from '../src/built/generic-segment-mapper.js';

describe('segment-contract schema', () => {
  it('accepts text segment', () => {
    const seg = { type: 'text', data: { text: 'hello' } };
    expect(textSegmentSchema.safeParse(seg).success).toBe(true);
    expect(isCanonicalSegment(seg)).toBe(true);
  });

  it('accepts mention segment with target all', () => {
    const seg = { type: 'mention', data: { target: 'all', name: '全体成员' } };
    expect(mentionSegmentSchema.safeParse(seg).success).toBe(true);
    expect(isCanonicalSegment(seg)).toBe(true);
  });

  it('rejects mention without target', () => {
    const seg = { type: 'mention', data: { name: 'bob' } };
    expect(mentionSegmentSchema.safeParse(seg).success).toBe(false);
    expect(isCanonicalSegment(seg)).toBe(false);
  });

  it('rejects image without media', () => {
    const seg = { type: 'image', data: { url: 'https://x/y.jpg' } };
    expect(isCanonicalSegment(seg)).toBe(false);
  });

  it('accepts image segment with MediaRef', () => {
    const seg = {
      type: 'image',
      data: {
        media: { kind: 'url', value: 'https://cdn.example/a.jpg', mime_type: 'image/jpeg' },
        alt: 'pic',
      },
    };
    expect(isCanonicalSegment(seg)).toBe(true);
  });

  it('strictly validates MediaRef for every built-in media segment', () => {
    const valid = [
      { type: 'audio', data: { media: { kind: 'url', value: 'https://cdn.example/a.mp3' } } },
      { type: 'video', data: { media: { kind: 'path', value: '/tmp/a.mp4' } } },
      { type: 'file', data: { media: { kind: 'file', value: 'platform-file-1' } } },
    ];
    for (const segment of valid) expect(isCanonicalSegment(segment)).toBe(true);

    const invalid = [
      { type: 'audio', data: { media: { kind: 'url' } } },
      { type: 'video', data: { media: { kind: 'blob', value: 'video-1' } } },
      { type: 'file', data: { media: { kind: 'base64', value: 42 } } },
    ];
    for (const segment of invalid) expect(isCanonicalSegment(segment)).toBe(false);
  });

  it('allows controlled extension types but rejects bare unknown types', () => {
    expect(isCanonicalSegment({ type: 'keyboard', data: { rows: [] } })).toBe(true);
    expect(isCanonicalSegment({ type: 'acme:poll', data: { options: [] } })).toBe(true);
    expect(isCanonicalSegment({ type: 'acme:poll', data: {}, platform: { version: 1 } })).toBe(true);
    expect(isCanonicalSegment({ type: 'poll', data: { options: [] } })).toBe(false);
    expect(isCanonicalSegment({ type: 'acme:poll', data: [] })).toBe(false);
  });

  it('accepts reply with message_id', () => {
    const seg = { type: 'reply', data: { message_id: '123' } };
    expect(isCanonicalSegment(seg)).toBe(true);
  });

  it('rejects reply with only legacy id', () => {
    const seg = { type: 'reply', data: { id: '123' } };
    expect(isCanonicalSegment(seg)).toBe(false);
  });

  it('accepts forward with forward_id', () => {
    const seg = { type: 'forward', data: { forward_id: 'resid-1', title: '群聊' } };
    expect(isCanonicalSegment(seg)).toBe(true);
  });

  it('accepts face and dice/rps', () => {
    expect(isCanonicalSegment({ type: 'face', data: { id: 66, name: '笑哭' } })).toBe(true);
    expect(isCanonicalSegment({ type: 'dice', data: {} })).toBe(true);
    expect(isCanonicalSegment({ type: 'rps', data: { result: 2 } })).toBe(true);
  });
});

describe('assertCanonicalSegments', () => {
  it('passes valid array', () => {
    const segments = [
      { type: 'text', data: { text: 'hi' } },
      { type: 'mention', data: { target: '10001', name: 'Alice' } },
    ];
    expect(() => assertCanonicalSegments(segments)).not.toThrow();
  });

  it('throws on invalid mention', () => {
    expect(() =>
      assertCanonicalSegments([{ type: 'mention', data: {} }]),
    ).toThrow(/segment\[0\]/);
  });
});

describe('segmentsForImDelivery', () => {
  it('keeps text and mention', () => {
    const input = [
      { type: 'text', data: { text: 'a' } },
      { type: 'mention', data: { target: 'all' } },
    ];
    expect(segmentsForImDelivery(input)).toEqual(input);
  });

  it('drops thinking and tool_call', () => {
    const input = [
      { type: 'text', data: { text: 'visible' } },
      { type: 'thinking', data: { text: 'hidden' } },
      { type: 'tool_call', data: { id: '1', name: 'x', arguments: '{}' } },
    ];
    expect(segmentsForImDelivery(input)).toEqual([
      { type: 'text', data: { text: 'visible' } },
    ]);
  });

  it('drops unknown non-IM types', () => {
    const input = [
      { type: 'text', data: { text: 'ok' } },
      { type: 'custom_internal', data: {} },
    ];
    expect(segmentsForImDelivery(input)).toEqual([
      { type: 'text', data: { text: 'ok' } },
    ]);
  });

  it('keeps IM-visible whitelist types', () => {
    const cases: Array<{ type: string; data: Record<string, unknown> }> = [
      { type: 'text', data: { text: 'x' } },
      { type: 'mention', data: { target: 'all' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://x/y.jpg' } } },
      { type: 'markdown', data: { content: '# hi' } },
      { type: 'keyboard', data: { rows: [] } },
    ];
    for (const seg of cases) {
      expect(segmentsForImDelivery([seg])).toEqual([seg]);
    }
  });
});

describe('collectSegmentMedia（入站媒体提取）', () => {
  it('returns empty for undefined / empty / text-only segments', () => {
    expect(collectSegmentMedia(undefined)).toEqual([]);
    expect(collectSegmentMedia([])).toEqual([]);
    expect(collectSegmentMedia([{ type: 'text', data: { text: 'hi' } }])).toEqual([]);
  });

  it('collects MediaRef from image / audio / video / file segments', () => {
    const media = collectSegmentMedia([
      { type: 'text', data: { text: '看图' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://cdn.example/a.jpg', mime_type: 'image/jpeg' } } },
      { type: 'audio', data: { media: { kind: 'url', value: 'https://cdn.example/a.mp3' } } },
      { type: 'video', data: { media: { kind: 'path', value: '/tmp/a.mp4' } } },
      { type: 'file', data: { media: { kind: 'base64', value: 'QUJD' } } },
      { type: 'mention', data: { target: 'all' } },
    ]);
    expect(media).toEqual([
      { type: 'image', media: { kind: 'url', value: 'https://cdn.example/a.jpg', mime_type: 'image/jpeg' } },
      { type: 'audio', media: { kind: 'url', value: 'https://cdn.example/a.mp3' } },
      { type: 'video', media: { kind: 'path', value: '/tmp/a.mp4' } },
      { type: 'file', media: { kind: 'base64', value: 'QUJD' } },
    ]);
  });

  it('skips media segments without a resolvable MediaRef', () => {
    expect(collectSegmentMedia([
      { type: 'image', data: {} },
      { type: 'image', data: { alt: 'nothing' } },
    ])).toEqual([]);
  });

  it('collects platform file references (kind=file) from canonical media', () => {
    const media = collectSegmentMedia([
      { type: 'image', data: { media: { kind: 'file', value: 'tg-file-id-1' } } },
      { type: 'file', data: { media: { kind: 'file', value: 'milky-file-id-2', mime_type: 'application/pdf' } } },
    ]);
    expect(media).toEqual([
      { type: 'image', media: { kind: 'file', value: 'tg-file-id-1' } },
      { type: 'file', media: { kind: 'file', value: 'milky-file-id-2', mime_type: 'application/pdf' } },
    ]);
    expect(isMediaRef({ kind: 'file', value: 'x' })).toBe(true);
  });

  it('collectSegmentMedia 只认 canonical data.media（legacy 形状不收集）', () => {
    const media = collectSegmentMedia([
      { type: 'image', data: { url: 'https://example.com/a.png' } },
      { type: 'file', data: { file_id: 'legacy-file-id' } },
    ]);
    expect(media).toEqual([]);
  });
});

describe('toCanonicalSegments（入站媒体兼容边界）', () => {
  it('normalizes legacy media shapes once before consumers inspect them', () => {
    expect(toCanonicalSegments([
      { type: 'audio', data: { url: 'https://cdn.example/a.mp3' } },
      { type: 'video', data: { path: '/tmp/a.mp4', duration: 12 } },
      { type: 'file', data: { file: 'platform-file-id', fileName: 'report.pdf' } },
    ])).toEqual([
      { type: 'audio', data: { media: { kind: 'url', value: 'https://cdn.example/a.mp3' } } },
      { type: 'video', data: { media: { kind: 'path', value: '/tmp/a.mp4' }, duration: 12 } },
      {
        type: 'file',
        data: { media: { kind: 'file', value: 'platform-file-id' }, name: 'report.pdf' },
      },
    ]);
  });
});
