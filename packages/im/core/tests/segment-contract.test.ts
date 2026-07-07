import { describe, expect, it } from 'vitest';
import {
  assertCanonicalSegments,
  isCanonicalSegment,
  segmentsForImDelivery,
  textSegmentSchema,
  mentionSegmentSchema,
} from '../src/built/segment-contract/index.js';

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
