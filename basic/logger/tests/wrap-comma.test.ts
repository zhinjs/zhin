import { describe, expect, it } from 'vitest';
import { wrapCommaSeparated } from '../src/log-panel.js';

describe('wrapCommaSeparated', () => {
  it('keeps short text on one line', () => {
    expect(wrapCommaSeparated('a, b, c', 40)).toEqual(['a, b, c']);
  });

  it('wraps long comma lists', () => {
    const lines = wrapCommaSeparated(
      'unified_inbox_message, unified_inbox_request, unified_inbox_notice, im_transcripts',
      40,
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(', ')).toContain('unified_inbox_message');
  });
});
