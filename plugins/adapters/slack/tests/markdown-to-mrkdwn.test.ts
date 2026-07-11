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
});
