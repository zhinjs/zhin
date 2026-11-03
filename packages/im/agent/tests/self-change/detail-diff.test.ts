import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_IM_DIFF_EXCERPT_BYTES,
  MAX_IM_DIFF_EXCERPT_LINES,
  buildSelfChangeDetailDiff,
  selfChangeDiffExcerpt,
  skippedTrialChecks,
  unifiedDiff,
} from '../../src/self-change/detail-diff.js';
import { SelfChangeStore, type SelfChangeOrigin } from '../../src/self-change/store.js';

const origin: SelfChangeOrigin = { platform: 'icqq', sceneId: 'group:500', userId: '42', endpoint: 'bot-1' };

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'zhin-change-detail-diff-')); });
afterEach(() => rmSync(project, { recursive: true, force: true }));

function makeStore(): SelfChangeStore {
  return new SelfChangeStore({ root: join(project, '.zhin', 'changes'), projectRoot: project });
}

function writeProjectFile(target: string, content: string): void {
  const absolute = join(project, ...target.split('/'));
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

describe('unifiedDiff', () => {
  it('renders a modify hunk with three lines of context', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
    const after = ['a', 'b', 'c', 'd', 'E', 'f', 'g', 'h'].join('\n');
    expect(unifiedDiff('commands/x.ts', before, after)).toBe([
      '--- a/commands/x.ts',
      '+++ b/commands/x.ts',
      '@@ -2,7 +2,7 @@',
      ' b',
      ' c',
      ' d',
      '-e',
      '+E',
      ' f',
      ' g',
      ' h',
    ].join('\n'));
  });

  it('uses /dev/null for created and deleted files', () => {
    expect(unifiedDiff('commands/new.ts', null, 'one\ntwo\n')).toBe([
      '--- /dev/null',
      '+++ b/commands/new.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
    ].join('\n'));
    expect(unifiedDiff('commands/old.ts', 'gone\n', null)).toBe([
      '--- a/commands/old.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-gone',
    ].join('\n'));
  });

  it('splits distant changes into separate hunks and returns an empty string when nothing changed', () => {
    const before = Array.from({ length: 30 }, (_, index) => `line ${index}`);
    const after = [...before];
    after[2] = 'changed 2';
    after[25] = 'changed 25';
    const diff = unifiedDiff('a.ts', before.join('\n'), after.join('\n'));
    expect(diff.split('\n').filter(line => line.startsWith('@@'))).toEqual(['@@ -1,6 +1,6 @@', '@@ -23,7 +23,7 @@']);
    expect(unifiedDiff('a.ts', 'same\n', 'same\n')).toBe('');
  });

  it('keeps moved lines as a remove plus an add (LCS)', () => {
    const diff = unifiedDiff('a.ts', 'x\ny\nz\n', 'y\nz\nx\n');
    expect(diff).toContain('-x');
    expect(diff).toContain('+x');
    expect(diff).toContain(' y');
  });
});

describe('buildSelfChangeDetailDiff', () => {
  it('diffs staged content against the production file for create, modify and delete', async () => {
    writeProjectFile('commands/ping.ts', 'export default 1;\n');
    writeProjectFile('commands/old.ts', 'export default 0;\n');
    const store = makeStore();
    const draft = await store.draft({
      origin,
      files: [
        { path: 'commands/ping.ts', content: 'export default 2;\n' },
        { path: 'commands/new.ts', content: 'export default 3;\n' },
        { path: 'commands/old.ts', delete: true },
      ],
    });
    const detail = await buildSelfChangeDetailDiff({ store, record: draft, projectRoot: project });
    expect(detail).toMatchObject({ bodiesAvailable: true, baseline: 'disk', truncated: false });
    expect(detail.files.map(file => [file.path, file.kind])).toEqual([
      ['commands/ping.ts', 'modify'],
      ['commands/new.ts', 'create'],
      ['commands/old.ts', 'delete'],
    ]);
    expect(detail.files[0]!.diff).toContain('-export default 1;\n+export default 2;');
    expect(detail.files[1]!.diff).toContain('--- /dev/null');
    expect(detail.files[2]!.diff).toContain('+++ /dev/null');
    expect(detail.bytes).toBe(detail.files.reduce((sum, file) => sum + Buffer.byteLength(file.diff ?? '', 'utf8'), 0));
  });

  it('cuts by line once the total budget is used and marks the rest', async () => {
    const store = makeStore();
    const big = Array.from({ length: 200 }, (_, index) => `const value${index} = ${index};`).join('\n');
    const draft = await store.draft({
      origin,
      files: [
        { path: 'commands/a.ts', content: big },
        { path: 'commands/b.ts', content: 'export default 1;\n' },
      ],
    });
    const detail = await buildSelfChangeDetailDiff({ store, record: draft, projectRoot: project, maxBytes: 500 });
    expect(detail.bytes).toBeLessThanOrEqual(500);
    expect(detail.truncated).toBe(true);
    expect(detail.files[0]).toMatchObject({ truncated: true, unavailableReason: null });
    expect(detail.files[0]!.diff!.endsWith('\n')).toBe(false);
    expect(detail.files[1]).toMatchObject({ diff: null, truncated: true, unavailableReason: 'budget_exhausted' });
  });

  it('does not follow a symlinked production file', async () => {
    writeFileSync(join(project, 'outside.txt'), 'outside secret\n');
    mkdirSync(join(project, 'commands'), { recursive: true });
    symlinkSync(join(project, 'outside.txt'), join(project, 'commands', 'link.ts'));
    const store = makeStore();
    const draft = await store.draft({ origin, files: [{ path: 'commands/link.ts', content: 'export default 1;\n' }] });
    const detail = await buildSelfChangeDetailDiff({ store, record: draft, projectRoot: project });
    expect(detail.files[0]).toMatchObject({ kind: 'modify', diff: null, unavailableReason: 'baseline_unreadable' });
    expect(JSON.stringify(detail)).not.toContain('outside secret');
  });

  it('reports a slimmed change as bodies unavailable instead of inventing a diff', async () => {
    const store = makeStore();
    const draft = await store.draft({ origin, files: [{ path: 'commands/ping.ts', content: 'export default 1;\n' }] });
    const expired = await store.transition(draft.id, 'expired', { actor: 'policy' });
    expect(expired.slimmed).toBe(true);
    const detail = await buildSelfChangeDetailDiff({ store, record: expired, projectRoot: project });
    expect(detail).toMatchObject({ bodiesAvailable: false, bytes: 0, truncated: true });
    expect(detail.files).toEqual([
      { path: 'commands/ping.ts', kind: 'modify', diff: null, truncated: true, unavailableReason: 'slimmed' },
    ]);
  });
});

describe('selfChangeDiffExcerpt', () => {
  it('stays within 40 lines and 2 KB and flags the cut', async () => {
    const store = makeStore();
    const content = Array.from({ length: 120 }, (_, index) => `line ${index} ${'x'.repeat(30)}`).join('\n');
    const draft = await store.draft({ origin, files: [{ path: 'commands/a.ts', content }] });
    const detail = await buildSelfChangeDetailDiff({ store, record: draft, projectRoot: project });
    const excerpt = selfChangeDiffExcerpt(detail);
    expect(excerpt.truncated).toBe(true);
    expect(excerpt.lines.length).toBeLessThanOrEqual(MAX_IM_DIFF_EXCERPT_LINES);
    expect(Buffer.byteLength(excerpt.lines.join('\n'), 'utf8')).toBeLessThanOrEqual(MAX_IM_DIFF_EXCERPT_BYTES);
    expect(excerpt.lines[0]).toBe('# create commands/a.ts');
    expect(excerpt.lines.some(line => line.startsWith('+++ ') || line.startsWith('--- '))).toBe(false);
  });

  it('covers a small change completely and notes unavailable files', () => {
    const excerpt = selfChangeDiffExcerpt({
      bodiesAvailable: true,
      baseline: 'disk',
      bytes: 0,
      truncated: false,
      files: [
        { path: 'a.ts', kind: 'modify', diff: unifiedDiff('a.ts', 'x\n', 'y\n'), truncated: false, unavailableReason: null },
      ],
    });
    expect(excerpt).toEqual({ lines: ['# modify a.ts', '@@ -1,1 +1,1 @@', '-x', '+y'], truncated: false });
  });
});

describe('skippedTrialChecks', () => {
  it('lists skipped checks by name and path, deduplicated', () => {
    expect(skippedTrialChecks({
      checks: [
        { check: 'syntax', path: 'commands/a.tsx', status: 'skipped' },
        { check: 'syntax', path: 'commands/a.tsx', status: 'skipped' },
        { check: 'default_export', path: 'commands/a.tsx', status: 'passed' },
        { check: 'plugin_tests', path: '', status: 'skipped' },
      ],
    })).toEqual(['syntax commands/a.tsx', 'plugin_tests']);
    expect(skippedTrialChecks(null)).toEqual([]);
  });
});
