/**
 * Editor temp, swap, lock, and backup files that must never trigger an HMR
 * reload (#857 P2-11).
 *
 * Editors write these next to the real source while saving. Several of them
 * keep the source extension (for example `.!97910!index.ts`), so an
 * extension allow-list alone is not enough.
 *
 * Matching uses the basename only, so a directory such as `tmp/` or a file
 * such as `tmp.ts` or `foo.tmp.ts` is still watched: those are ordinary
 * sources a plugin may really import. Only the exact shapes below are skipped.
 */
import { basename } from 'node:path';

interface EditorTempPattern {
  readonly editor: string;
  readonly test: (name: string) => boolean;
}

/** Ordered, documented list; each entry is covered by a unit test. */
export const EDITOR_TEMP_FILE_PATTERNS: readonly EditorTempPattern[] = Object.freeze([
  // `.!<digits>!<name>`: atomic-save temp file seen in practice (`.!97910!index.ts`).
  { editor: 'atomic save (.!<pid>!name)', test: (name) => /^\.!\d+!/.test(name) },
  // Vim swap files: `.index.ts.swp`, then `.swo`, `.swx` when the first one is taken.
  { editor: 'vim swap (*.swp, *.swo, *.swx)', test: (name) => /\.sw[pox]$/.test(name) },
  // Vim `writebackup` probe: Vim creates and deletes `4913` to test the directory.
  { editor: 'vim probe (4913)', test: (name) => name === '4913' },
  // Backup copies from Vim, Emacs, nano and others: `index.ts~`.
  { editor: 'backup (*~)', test: (name) => name.endsWith('~') },
  // Emacs lock files: `.#index.ts` (usually a dangling symlink).
  { editor: 'emacs lock (.#*)', test: (name) => name.startsWith('.#') },
  // Generic temp files: `index.ts.tmp`. `foo.tmp.ts` is a real source and still reloads.
  { editor: 'temp (*.tmp)', test: (name) => name.endsWith('.tmp') },
  // JetBrains "safe write": `index.ts___jb_tmp___` and `index.ts___jb_old___`.
  {
    editor: 'JetBrains safe write (*___jb_tmp___, *___jb_old___)',
    test: (name) => name.endsWith('___jb_tmp___') || name.endsWith('___jb_old___'),
  },
]);

/**
 * Returns true when `source` (a path or a bare file name) is an editor temp or
 * backup file. Only the basename is inspected.
 */
export function isEditorTempFile(source: string): boolean {
  // Accept both separators so Windows paths behave the same on every host.
  const name = basename(source.replaceAll('\\', '/'));
  if (!name) return false;
  return EDITOR_TEMP_FILE_PATTERNS.some((pattern) => pattern.test(name));
}
