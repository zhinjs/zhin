import { describe, expect, it } from 'vitest';
import { markdownToMrkdwn, mrkdwnToPlainFallback, splitMrkdwnText, SLACK_MRKDWN_TEXT_MAX } from '../src/markdown-to-mrkdwn.js';

describe('markdownToMrkdwn', () => {
  it('converts **bold** to Slack mrkdwn', () => {
    expect(markdownToMrkdwn('**日常工具**')).toBe('*日常工具*');
  });

  it('converts markdown links', () => {
    expect(markdownToMrkdwn('[Example](https://example.com)')).toBe('<https://example.com|Example>');
  });

  it('converts headings to bold', () => {
    expect(markdownToMrkdwn('### Title')).toBe('*Title*');
  });
});

describe('splitMrkdwnText', () => {
  it('splits long text near newline boundaries', () => {
    const line = 'a'.repeat(100);
    const text = Array.from({ length: 35 }, () => line).join('\n');
    const chunks = splitMrkdwnText(text, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
    }
    expect(chunks.join('\n')).toBe(text);
  });

  it('keeps short text as single chunk', () => {
    expect(splitMrkdwnText('hi', SLACK_MRKDWN_TEXT_MAX)).toEqual(['hi']);
  });
});

describe('mrkdwnToPlainFallback', () => {
  it('strips mrkdwn markers', () => {
    expect(mrkdwnToPlainFallback('*日常工具*')).toBe('日常工具');
  });

  it('rewrites <url|text> links as "text (url)"', () => {
    expect(mrkdwnToPlainFallback('<https://a.com|A 站点>')).toBe('A 站点 (https://a.com)');
    expect(mrkdwnToPlainFallback('看 <https://a.com|这里> 吧')).toBe('看 这里 (https://a.com) 吧');
  });

  it('strips angle brackets without a pipe', () => {
    expect(mrkdwnToPlainFallback('<@U123> 好')).toBe('@U123 好');
  });

  it('keeps legacy edge-case semantics (empty <> / edge pipes / multi pipe)', () => {
    expect(mrkdwnToPlainFallback('<>')).toBe('<>');
    expect(mrkdwnToPlainFallback('<|x>')).toBe('|x');
    expect(mrkdwnToPlainFallback('<x|>')).toBe('x|');
    expect(mrkdwnToPlainFallback('<a|b|c>')).toBe('b|c (a)');
    expect(mrkdwnToPlainFallback('<x <y|z> w>')).toBe('z (x y) w');
  });

  it('handles 100k adversarial angle input in linear time (no ReDoS)', () => {
    const input = `<${'a|'.repeat(50_000)}`;
    const start = performance.now();
    const result = mrkdwnToPlainFallback(input);
    expect(performance.now() - start).toBeLessThan(100);
    expect(result.length).toBeGreaterThan(0);
  });
});
