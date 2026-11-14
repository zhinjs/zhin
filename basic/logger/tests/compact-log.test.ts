import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  addCompactUsage,
  formatCompact,
  formatCompactLog,
  formatCompactUsage,
  escapeLogText,
  LOG_CONTENT_MAX_LENGTH,
  truncatePreview,
} from '../src/compact-log.js';

describe('compact-log', () => {
  it('formatCompact joins fields with pipe', () => {
    expect(formatCompact({ a: 1, b: 2 })).toBe('a: 1 | b: 2');
  });

  it('formatCompact lifts op as bare leading verb', () => {
    expect(formatCompact({
      op: 'recv',
      endpoint: '210723495',
      preview: 'hi',
    })).toBe('recv | endpoint: 210723495 | preview: hi');
  });

  it('formatCompact renders true flags as bare keys', () => {
    expect(formatCompact({
      op: 'recv',
      mentioned: true,
      preview: 'hi',
    })).toBe('recv | mentioned | preview: hi');
  });

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

  it('truncatePreview keeps full text by default', () => {
    expect(truncatePreview('hello world')).toBe('hello world');
    expect(truncatePreview('x'.repeat(200))).toBe('x'.repeat(200));
  });

  it('truncatePreview can opt-in max length', () => {
    expect(truncatePreview('x'.repeat(200), 10)).toBe('xxxxxxxxxx...');
  });

  it('truncatePreview caps user content at the default length (#1250)', () => {
    expect(truncatePreview('x'.repeat(LOG_CONTENT_MAX_LENGTH + 50))).toBe(`${'x'.repeat(LOG_CONTENT_MAX_LENGTH)}...`);
  });

  it('keeps multi-line content on one log line (#1250)', () => {
    // A forged entry inside a chat message must not start a line of its own.
    const forged = 'hi\n[10:00:00.000][ERROR] [gateway] owner password reset\r\nbye';
    expect(truncatePreview(forged)).toBe('hi⏎[10:00:00.000][ERROR] [gateway] owner password reset⏎bye');
    expect(truncatePreview(forged)).not.toMatch(/[\r\n]/u);
    expect(escapeLogText('a\u2028b\u2029c')).toBe('a⏎b⏎c');
  });

  it('escapes ANSI and other control characters but keeps tabs (#1250)', () => {
    expect(escapeLogText('\u001b[31mred\u001b[0m\tx\u0007')).toBe('\\u001b[31mred\\u001b[0m\tx\\u0007');
  });

  it('addCompactUsage', () => {
    const t = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    addCompactUsage(t, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    expect(t.total_tokens).toBe(15);
  });

  it('formatCompact shortens path-like fields', () => {
    const root = path.resolve('/tmp/zhin-compact-root');
    const abs = path.join(root, 'zhin.config.yml');
    expect(
      formatCompact({ configPath: abs }, { projectRoot: root, homeDir: '/tmp/unused' }),
    ).toBe('configPath: ./zhin.config.yml');
  });

  it('formatCompact leaves http URLs unchanged', () => {
    expect(formatCompact({ url: 'https://example.com/webhook' })).toBe(
      'url: https://example.com/webhook',
    );
  });
});
