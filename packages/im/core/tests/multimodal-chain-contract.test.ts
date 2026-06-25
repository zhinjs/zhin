/**
 * Multimodal / Rich Segment 链契约（check:l4）
 */
import { describe, it, expect } from 'vitest';
import {
  resolveRichSegments,
  DEFAULT_OUTBOUND_RICH_SEGMENT_POLICY,
  segment,
  OUTBOUND_RICH_SEGMENT_POLICY_TEXT_ONLY,
} from '@zhin.js/core';

describe('multimodal chain contract', () => {
  it('resolveRichSegments passes through plain text', async () => {
    const out = await resolveRichSegments('hello', DEFAULT_OUTBOUND_RICH_SEGMENT_POLICY);
    expect(out).toBe('hello');
  });

  it('html falls back to text without html-renderer peer', async () => {
    const out = await resolveRichSegments(
      segment('html', { html: '<p>hi</p>' }),
      { ...DEFAULT_OUTBOUND_RICH_SEGMENT_POLICY, html: 'image' },
    );
    const items = Array.isArray(out) ? out : [out];
    const textSeg = items.find((i) => typeof i !== 'string' && i.type === 'text');
    expect(textSeg).toBeDefined();
  });

  it('text-only policy renders qrcode as text', async () => {
    const out = await resolveRichSegments(
      segment('qrcode', { text: 'https://example.com' }),
      OUTBOUND_RICH_SEGMENT_POLICY_TEXT_ONLY,
    );
    const items = Array.isArray(out) ? out : [out];
    expect(items.some((i) => typeof i !== 'string' && i.type === 'text')).toBe(true);
  });

  it('logs rich_segment via context callback', async () => {
    const logs: Record<string, unknown>[] = [];
    await resolveRichSegments(
      segment('qrcode', { text: 'x' }),
      DEFAULT_OUTBOUND_RICH_SEGMENT_POLICY,
      {
        resolveCapability: async () => undefined,
        logContentChain: (fields) => logs.push(fields),
      },
    );
    expect(logs.some((l) => l.stage === 'rich_segment' && l.kind === 'qrcode')).toBe(true);
  });
});
