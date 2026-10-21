import { describe, expect, it } from 'vitest';
import { EDITOR_TEMP_FILE_PATTERNS, isEditorTempFile } from '../src/editor-temp-file.js';

describe('isEditorTempFile (#857 P2-11)', () => {
  it.each([
    // atomic save temp file seen in practice
    ['.!97910!index.ts'],
    ['.!1!plugin.yml'],
    // vim swap files
    ['.index.ts.swp'],
    ['index.ts.swo'],
    ['.index.ts.swx'],
    ['.env.swp'],
    // vim writebackup probe
    ['4913'],
    // backups
    ['index.ts~'],
    ['.env~'],
    // emacs locks
    ['.#index.ts'],
    // generic temp
    ['index.ts.tmp'],
    ['schedule-jobs.json.tmp'],
    // JetBrains safe write
    ['index.ts___jb_tmp___'],
    ['index.ts___jb_old___'],
  ])('ignores %s', (name) => {
    expect(isEditorTempFile(name)).toBe(true);
  });

  it.each([
    ['index.ts'],
    ['tmp.ts'],
    ['foo.tmp.ts'],
    ['swp.ts'],
    ['4913.ts'],
    ['49130'],
    ['.env'],
    ['.env.local'],
    ['README.md'],
    ['plugin.yml'],
    ['a!b.ts'],
    ['.!abc!index.ts'],
    ['jb_tmp.ts'],
    ['index.#ts'],
  ])('still reloads %s', (name) => {
    expect(isEditorTempFile(name)).toBe(false);
  });

  it('matches on the basename only, for POSIX and Windows paths', () => {
    expect(isEditorTempFile('/project/plugins/x/commands/status/.!97910!index.ts')).toBe(true);
    expect(isEditorTempFile('C:\\project\\commands\\status\\index.ts~')).toBe(true);
    // A directory named like a temp file does not hide the real source inside it.
    expect(isEditorTempFile('/project/tmp/index.ts')).toBe(false);
    expect(isEditorTempFile('/project/.#dir/index.ts')).toBe(false);
    expect(isEditorTempFile('/project/4913/index.ts')).toBe(false);
    expect(isEditorTempFile('')).toBe(false);
  });

  it('documents every pattern with an editor label', () => {
    expect(EDITOR_TEMP_FILE_PATTERNS.length).toBeGreaterThanOrEqual(7);
    for (const pattern of EDITOR_TEMP_FILE_PATTERNS) expect(pattern.editor).not.toBe('');
  });
});
