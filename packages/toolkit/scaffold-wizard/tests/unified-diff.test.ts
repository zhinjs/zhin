import { describe, expect, it } from 'vitest';
import { unifiedLineDiff } from '../src/unified-diff.js';

const names = { from: 'a/x.yml', to: 'b/x.yml', context: 1 } as const;

describe('unifiedLineDiff', () => {
  it('is empty when the texts are the same', () => {
    expect(unifiedLineDiff('a\nb\n', 'a\nb\n', names)).toBe('');
  });

  it('notes a line-ending change of the whole file once instead of listing every line', () => {
    expect(unifiedLineDiff('a\nb\n', 'a\r\nb\r\n', names)).toBe('--- a/x.yml\n+++ b/x.yml\n# line endings: LF -> CRLF\n');
    expect(unifiedLineDiff('a\r\nb\r\n', 'a\nB\n', names)).toBe([
      '--- a/x.yml', '+++ b/x.yml', '# line endings: CRLF -> LF', '@@ -1,2 +1,2 @@', ' a', '-b', '+B', '',
    ].join('\n'));
  });

  it('names a single line whose only change is its ending', () => {
    expect(unifiedLineDiff('a\nb\r\nc\n', 'a\nb\nc\n', names)).toBe([
      '--- a/x.yml', '+++ b/x.yml', '@@ -1,3 +1,3 @@', ' a', '-b (CRLF)', '+b (LF)', ' c', '',
    ].join('\n'));
  });

  it('shows a missing newline at the end of the file', () => {
    expect(unifiedLineDiff('a\nb', 'a\nb\n', names)).toBe([
      '--- a/x.yml', '+++ b/x.yml', '@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+b', '',
    ].join('\n'));
    expect(unifiedLineDiff('a\nb', 'z\nb', names)).toBe([
      '--- a/x.yml', '+++ b/x.yml', '@@ -1,2 +1,2 @@', '-a', '+z', ' b', '\\ No newline at end of file', '',
    ].join('\n'));
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
