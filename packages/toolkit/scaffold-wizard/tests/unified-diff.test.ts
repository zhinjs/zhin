import { describe, expect, it } from 'vitest';
import { unifiedLineDiff } from '../src/unified-diff.js';

const names = { from: 'a/x.yml', to: 'b/x.yml', context: 1 } as const;

describe('unifiedLineDiff', () => {
  it('is empty when the lines are the same', () => {
    expect(unifiedLineDiff('a\nb\n', 'a\r\nb\r\n', names)).toBe('');
  });

  it('prints changed lines with their context and hunk ranges', () => {
    const before = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n';
    const after = 'one\n2\nthree\nfour\nfive\nsix\nseven\neight\n';
    expect(unifiedLineDiff(before, after, names)).toBe([
      '--- a/x.yml',
      '+++ b/x.yml',
      '@@ -1,3 +1,3 @@',
      ' one',
      '-two',
      '+2',
      ' three',
      '@@ -7 +7,2 @@',
      ' seven',
      '+eight',
      '',
    ].join('\n'));
  });

  it('names the line before an empty range', () => {
    expect(unifiedLineDiff('', 'new\n', names)).toBe('--- a/x.yml\n+++ b/x.yml\n@@ -0,0 +1 @@\n+new\n');
  });
});
