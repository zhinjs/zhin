// What a project actually installed vs what package.json declares (#1250).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import { compareInstalledVersions, explainVersionMismatch, syncReleaseAgeExclusions } from '../../src/utils/installed-versions.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function root(workspace?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-versions-'));
  roots.push(dir);
  if (workspace !== undefined) fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), workspace);
  return dir;
}

function install(dir: string, name: string, version: string): void {
  fs.mkdirSync(path.join(dir, 'node_modules', name), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
}

describe('compareInstalledVersions', () => {
  it('classifies installed, outdated, missing and non-range specifiers', () => {
    const dir = root();
    install(dir, 'zhin.js', '1.2.0');
    install(dir, '@zhin.js/core', '1.6.0');
    install(dir, '@zhin.js/tool', '1.0.0');
    const rows = compareInstalledVersions(dir, { 'zhin.js': '^1.2.0', '@zhin.js/core': '^1.7.0', '@zhin.js/cli': '^1.3.0', '@zhin.js/tool': 'workspace:*' }, new Map([['zhin.js', '1.1.27']]));
    expect(rows.map(row => [row.name, row.status, row.before, row.after])).toEqual([
      ['zhin.js', 'ok', '1.1.27', '1.2.0'],
      ['@zhin.js/core', 'mismatch', undefined, '1.6.0'],
      ['@zhin.js/cli', 'missing', undefined, undefined],
      ['@zhin.js/tool', 'unchecked', undefined, '1.0.0'],
    ]);
  });
});

describe('syncReleaseAgeExclusions', () => {
  it('appends name@version entries and keeps the existing ones and comments', () => {
    const dir = root("# ws\nminimumReleaseAgeExclude:\n  - 'zhin.js@1.2.0'\n");
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const added = syncReleaseAgeExclusions(dir, new Map([['zhin.js', '1.2.0'], ['@zhin.js/cli', '1.3.0'], ['left-pad', '1.0.0']]), false);
    expect(added).toEqual(['@zhin.js/cli@1.3.0']);
    const text = fs.readFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'utf8');
    expect(text).toContain('# ws');
    expect(yaml.parse(text).minimumReleaseAgeExclude).toEqual(['zhin.js@1.2.0', '@zhin.js/cli@1.3.0']);
  });

  it('treats a bare name, a scope pattern or a version list as covering the release; dry-run writes nothing', () => {
    const original = "minimumReleaseAgeExclude:\n  - zhin.js\n  - '@zhin.js/c*'\n  - '@zhin.js/gateway@1.1.0 || 1.2.0'\n";
    const dir = root(original);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(syncReleaseAgeExclusions(dir, new Map([['zhin.js', '1.2.0'], ['@zhin.js/cli', '1.3.0'], ['@zhin.js/gateway', '1.2.0'], ['@zhin.js/agent', '1.4.0']]), true))
      .toEqual(['@zhin.js/agent@1.4.0']);
    expect(fs.readFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'utf8')).toBe(original);
  });

  it('does not create a workspace file', () => {
    const dir = root();
    expect(syncReleaseAgeExclusions(dir, new Map([['zhin.js', '1.2.0']]), false)).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))).toBe(false);
  });
});

describe('explainVersionMismatch', () => {
  const row = { name: 'zhin.js', declared: '^1.2.0', after: '1.1.27', status: 'mismatch' as const };

  it('blames pnpm 11 release age by default, and not on older pnpm without the setting', () => {
    expect(explainVersionMismatch(root(), {}, row, 11)).toContain('minimumReleaseAge');
    expect(explainVersionMismatch(root(), {}, row, 10)).not.toContain('minimumReleaseAge');
    expect(explainVersionMismatch(root('minimumReleaseAge: 60\n'), {}, row, 10)).toContain('minimumReleaseAge');
    expect(explainVersionMismatch(root('minimumReleaseAge: 0\n'), {}, row, 11)).not.toContain('minimumReleaseAge');
  });

  it('names an override first', () => {
    expect(explainVersionMismatch(root(), { pnpm: { overrides: { 'zhin.js': '1.1.27' } } }, row, 11)).toContain('overrides 把 zhin.js 固定为 1.1.27');
  });
});
