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

  it('handles adversarial angle input in linear time (no ReDoS)', () => {
    // An unclosed `<` keeps its text, so long unclosed inputs come back unchanged.
    const unclosed = `<${'a|'.repeat(50_000)}`;
    expect(mrkdwnToPlainFallback(unclosed)).toBe(unclosed);
    // Every `<` opens a candidate link and no `>` closes one. The regexes this replaced
    // (`/<([^|>]+)\|([^>]+)>/g`, then `/<([^>]+)>/g`) rescanned the rest of the input from
    // each `<`: ~90 ms for 18 750 characters and ~1.8 s for 75 000.
    const adversarial = (repeats: number) => '<a|'.repeat(repeats);
    expect(mrkdwnToPlainFallback(adversarial(4))).toBe('<a|<a|<a|<a|');

    // Two guards, each measured as the best of three runs of one input, so a loaded
    // runner (the full suite, coverage instrumentation) does not decide the result:
    // - growth: a quadratic scan grows ~16x when the input grows 4x;
    // - a ceiling far below the ~1.8 s the replaced regexes needed for the large input.
    const fastest = (input: string) => {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 3; i += 1) {
        const started = performance.now();
        mrkdwnToPlainFallback(input);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    const small = fastest(adversarial(6_250));
    const large = fastest(adversarial(25_000));
    expect(large / Math.max(small, 0.5)).toBeLessThan(8);
    expect(large).toBeLessThan(500);
  });
});
