/**
 * #1250 `update-no-preview`: `zhin update --dry-run` lists what would be upgraded, per workspace
 * member, and writes nothing.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { previewUpdate, renderUpdatePreview, splitUpdateSpec } from '../../src/utils/update-preview.js';

let root: string;

function write(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
}

const published: Record<string, string[]> = {
  'zhin.js': ['1.3.0', '1.4.0', '1.4.2', '2.0.0-beta.1', '2.0.0'],
  '@zhin.js/core': ['1.8.0', '1.9.1'],
  left: ['1.0.0'],
};
const lookup = async (name: string) => published[name];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-update-preview-'));
  write('package.json', { name: 'bot', dependencies: { 'zhin.js': '^1.4.0', left: '^1.0.0', linked: 'workspace:*', gone: '^3.0.0' } });
  write('node_modules/zhin.js/package.json', { name: 'zhin.js', version: '1.4.0' });
  write('node_modules/left/package.json', { name: 'left', version: '1.0.0' });
  write('pnpm-workspace.yaml', 'packages:\n  - plugins/*\n');
  write('plugins/foo/package.json', { name: 'foo', devDependencies: { '@zhin.js/core': '~1.8.0', 'zhin.js': '^1.3.0' } });
  write('plugins/foo/node_modules/@zhin.js/core/package.json', { name: '@zhin.js/core', version: '1.8.0' });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('previewUpdate', () => {
  it('picks the newest version each range allows, for the root and every workspace member', async () => {
    const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    const preview = await previewUpdate(root, [], { publishedVersions: lookup });
    expect(preview.recursive).toBe(true);
    expect(preview.members).toEqual([
      { path: '.', name: 'bot', notDeclared: [], unknown: ['gone'], overridden: [],
        changes: [{ name: 'zhin.js', range: '^1.4.0', current: '1.4.0', target: '1.4.2', latestOutsideRange: '2.0.0' }] },
      // The member's zhin.js resolves from the root node_modules.
      { path: 'plugins/foo', name: 'foo', notDeclared: [], unknown: [], overridden: [],
        changes: [{ name: 'zhin.js', range: '^1.3.0', current: '1.4.0', target: '1.4.2', latestOutsideRange: '2.0.0' }] },
    ]);
    expect(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).toBe(before);
  });

  it('moves only the root to an exact version and names members that do not declare a package', async () => {
    const preview = await previewUpdate(root, ['zhin.js@2.0.0', '@zhin.js/core'], { publishedVersions: lookup });
    expect(preview.members[0]).toMatchObject({ notDeclared: ['@zhin.js/core'], changes: [{ name: 'zhin.js', current: '1.4.0', target: '2.0.0' }] });
    // ~1.8.0 already has the newest 1.8.x installed.
    expect(preview.members[1]).toMatchObject({ notDeclared: [], changes: [] });
    expect(splitUpdateSpec('@zhin.js/core@1.2.3')).toEqual({ name: '@zhin.js/core', version: '1.2.3' });
    expect(splitUpdateSpec('@zhin.js/core')).toEqual({ name: '@zhin.js/core' });
  });

  it('shows overridden packages at the override version and says what it cannot evaluate', async () => {
    write('package.json', { name: 'bot', dependencies: { 'zhin.js': '^1.3.0', left: '^1.0.0' }, pnpm: { overrides: { left: 'link:../left', 'zhin.js': '1.4.0' } } });
    // The workspace file wins on the same key; `$name` points at the root's own specifier.
    write('pnpm-workspace.yaml', "packages:\n  - '!**/test/**'\n  - plugins/*\noverrides:\n  zhin.js: '$zhin.js'\n  '@zhin.js/core': '~1.9.0'\n  'foo>bar': '1.0.0'\n");
    const preview = await previewUpdate(root, [], { publishedVersions: lookup });
    expect(preview.conditionalOverrides).toEqual(['foo>bar: 1.0.0']);
    expect(preview.members[0]).toMatchObject({
      overridden: ['left（link:../left）'],
      changes: [{ name: 'zhin.js', current: '1.4.0', target: '1.4.2', override: '$zhin.js' }],
    });
    expect(preview.members[1]!.changes).toEqual([
      { name: '@zhin.js/core', range: '~1.9.0', current: '1.8.0', target: '1.9.1', override: '~1.9.0' },
      { name: 'zhin.js', range: '^1.3.0', current: '1.4.0', target: '1.4.2', override: '$zhin.js', latestOutsideRange: '2.0.0' },
    ]);
    const lines = renderUpdatePreview(preview, false);
    expect(lines.some(line => line.includes('1.8.0 → 1.9.1（overrides：~1.9.0）'))).toBe(true);
    expect(lines).toContain('  由 overrides 决定、无法预览：left（link:../left）');
    expect(lines.some(line => line.includes('带条件的 overrides 没有计入预览') && line.includes('foo>bar'))).toBe(true);
  });

  it('treats any workspace packages entry as recursive, like the gateway', async () => {
    write('pnpm-workspace.yaml', "packages:\n  - '!plugins/foo'\n");
    expect((await previewUpdate(root, [], { publishedVersions: lookup })).recursive).toBe(true);
  });

  it('renders the plan and says nothing is changed', async () => {
    const lines = renderUpdatePreview(await previewUpdate(root, [], { publishedVersions: lookup }), true);
    expect(lines[0]).toContain('不会修改任何文件，也不会停止或重启实例');
    expect(lines).toContain('pnpm 工作区：zhin update 会一并更新 1 个成员（plugins/foo）。');
    expect(lines.some(line => line.includes('zhin.js  1.4.0 → 1.4.2（^1.4.0；最新 2.0.0 超出范围，不会升级）'))).toBe(true);
    expect(lines.some(line => line.includes('无法从 registry 查询：gone'))).toBe(true);
    expect(lines.some(line => line.startsWith('共 2 处升级') && line.includes('网关会先停止实例'))).toBe(true);
  });
});
