import { describe, expect, it } from 'vitest';
import { formatChipListLinesRaw } from '../src/log-panel.js';

describe('formatChipListLinesRaw', () => {
  it('joins pre-colored items without forcing cyan', () => {
    const text = formatChipListLinesRaw(['\x1b[32ma\x1b[0m', 'b'], 2);
    expect(text).toContain('\x1b[32ma\x1b[0m');
    expect(text).not.toMatch(/\x1b\[36m/);
  });
});
