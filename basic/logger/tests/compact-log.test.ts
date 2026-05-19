import { describe, expect, it } from 'vitest';
import {
  addCompactUsage,
  formatCompact,
  formatCompactLog,
  formatCompactUsage,
  truncatePreview,
} from '../src/compact-log.js';

describe('compact-log', () => {
  it('formatCompact skips empty fields', () => {
    expect(formatCompact({ a: 1, b: undefined, c: '' })).toBe('a: 1');
  });

  it('formatCompactLog adds tag prefix', () => {
    expect(formatCompactLog('Test', { a: 1, b: undefined, c: '' })).toBe('[Test] a: 1');
  });

  it('formatCompactUsage with subagent breakdown', () => {
    expect(
      formatCompactUsage(
        { prompt_tokens: 300, completion_tokens: 200, total_tokens: 500 },
        { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
      ),
    ).toBe('500 (In 300 / Out 200); main 300 + sub 200');
  });

  it('truncatePreview', () => {
    expect(truncatePreview('hello world')).toBe('hello world');
    expect(truncatePreview('x'.repeat(200), 10)).toBe('xxxxxxxxxx...');
  });

  it('addCompactUsage', () => {
    const t = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    addCompactUsage(t, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    expect(t.total_tokens).toBe(15);
  });
});
