import { describe, expect, it } from 'vitest';
import { mrkdwnToMarkdown } from '../src/mrkdwn-to-markdown.js';

describe('mrkdwnToMarkdown', () => {
  it('converts Slack bold to markdown', () => {
    expect(mrkdwnToMarkdown('*日常工具*')).toBe('**日常工具**');
  });

  it('converts Slack italic to markdown', () => {
    expect(mrkdwnToMarkdown('_italic_')).toBe('*italic*');
  });

  it('converts strikethrough', () => {
    expect(mrkdwnToMarkdown('~strike~')).toBe('~~strike~~');
  });

  it('converts Slack links', () => {
    expect(mrkdwnToMarkdown('<https://example.com|Example>')).toBe('[Example](https://example.com)');
  });

  it('preserves inline code', () => {
    expect(mrkdwnToMarkdown('use `code` here')).toBe('use `code` here');
  });
});
