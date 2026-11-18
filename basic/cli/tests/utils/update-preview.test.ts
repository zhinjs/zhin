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
    const preview = await previewUpdate(root, [], {
      publishedVersions: lookup,
      packageDependencies: async (name, version) => (name === 'zhin.js' && version === '1.4.2' ? { '@zhin.js/core': '1.9.1' } : undefined),
    });
    expect(preview.conditionalOverrides).toEqual(['foo>bar: 1.0.0']);
    // `$zhin.js` is the user's own wiring: it still decides the version.
    expect(preview.members[0]).toMatchObject({
      overridden: ['left（link:../left）'],
      changes: [{ name: 'zhin.js', current: '1.4.0', target: '1.4.2', override: '$zhin.js' }],
    });
    // #1250 update-overrides-not-synced: the Zhin version lock `~1.9.0` is released for the update
    // and written back as `~1.9.1` (zhin.js 1.4.2's core): that value, not the member's own `~1.8.0`,
    // decides the core it ends up with.
    expect(preview.members[1]!.changes).toEqual([
      { name: '@zhin.js/core', range: '~1.9.0', current: '1.8.0', target: '1.9.1', override: '~1.9.0' },
      { name: 'zhin.js', range: '^1.3.0', current: '1.4.0', target: '1.4.2', override: '$zhin.js', latestOutsideRange: '2.0.0' },
    ]);
    expect(preview.overrides).toEqual({
      changes: [
        { file: 'package.json', key: 'zhin.js', from: '1.4.0', to: '1.4.2' },
        { file: 'pnpm-workspace.yaml', key: '@zhin.js/core', from: '~1.9.0', to: '~1.9.1' },
      ],
      manual: [],
    });
    const lines = renderUpdatePreview(preview, false);
    expect(lines.some(line => line.includes('1.4.0 → 1.4.2（overrides：$zhin.js；'))).toBe(true);
    expect(lines.some(line => line.includes('1.8.0 → 1.9.1（overrides：~1.9.0 → ~1.9.1）'))).toBe(true);
    expect(lines).toContain('  由 overrides 决定、无法预览：left（link:../left）');
    expect(lines).toContain('  pnpm-workspace.yaml 的 overrides "@zhin.js/core": ~1.9.0 → ~1.9.1');
    expect(lines.some(line => line.includes('带条件的 overrides 没有计入预览') && line.includes('foo>bar'))).toBe(true);
  });

  it('leaves the Zhin overrides alone when the update names only other packages', async () => {
    write('package.json', { name: 'bot', dependencies: { 'zhin.js': '^1.3.0', left: '^1.0.0' }, pnpm: { overrides: { 'zhin.js': '1.4.0' } } });
    const preview = await previewUpdate(root, ['left'], { publishedVersions: lookup, packageDependencies: async () => { throw new Error('not asked'); } });
    expect(preview.overrides).toEqual({ changes: [], manual: [] });
    expect(preview.members[0]!.changes).toEqual([]);
  });

  it('lists the Zhin overrides it cannot sync with file and line', async () => {
    write('package.json', `${JSON.stringify({ name: 'bot', dependencies: { 'zhin.js': '^1.3.0' }, pnpm: { overrides: { 'zhin.js': '>=1.3 <1.5', '@zhin.js/core@<1.9': '1.8.0', left: '1.0.0' } } }, null, 2)}\n`);
    const preview = await previewUpdate(root, [], { publishedVersions: lookup, packageDependencies: async () => ({}) });
    expect(preview.overrides.changes).toEqual([]);
    expect(preview.overrides.manual).toEqual([
      '请手动修改 package.json:8（package.json 的 pnpm.overrides）"zhin.js": ">=1.3 <1.5"——版本范围「>=1.3 <1.5」无法自动同步，只支持精确版本或 ^ / ~ 版本；改成与升级后的 zhin.js 相同的版本，再运行 pnpm install',
      '请手动修改 package.json:9（package.json 的 pnpm.overrides）"@zhin.js/core@<1.9": "1.8.0"——键带版本选择器（@zhin.js/core@<1.9），升级后可能不再匹配；改成与升级后的 @zhin.js/core 相同的版本，再运行 pnpm install',
    ]);
    // A Zhin key that is not synced is no longer listed as an unapplied conditional override.
    expect(preview.conditionalOverrides).toEqual([]);
  });

  it('shows the version a synced override is written back with, even past the declared range', async () => {
    // The root declares core ^1.8.0 but zhin.js 1.4.2 requires core 1.9.1 exactly: the lock follows.
    published['@zhin.js/core'] = ['1.8.0', '1.9.1', '1.10.0'];
    try {
      write('package.json', { name: 'bot', dependencies: { 'zhin.js': '^1.4.0', '@zhin.js/core': '^1.8.0' }, pnpm: { overrides: { '@zhin.js/core': '1.8.0' } } });
      write('node_modules/@zhin.js/core/package.json', { name: '@zhin.js/core', version: '1.8.0' });
      const preview = await previewUpdate(root, [], {
        publishedVersions: lookup,
        packageDependencies: async (name, version) => (name === 'zhin.js' && version === '1.4.2' ? { '@zhin.js/core': '1.9.1' } : undefined),
      });
      expect(preview.overrides.changes).toEqual([{ file: 'package.json', key: '@zhin.js/core', from: '1.8.0', to: '1.9.1' }]);
      // Not 1.10.0 (what ^1.8.0 alone would pick): the written-back 1.9.1 decides.
      expect(preview.members[0]!.changes.find(change => change.name === '@zhin.js/core')).toEqual({ name: '@zhin.js/core', range: '1.8.0', current: '1.8.0', target: '1.9.1', override: '1.8.0' });
      expect(preview.members[1]!.changes.find(change => change.name === '@zhin.js/core')).toMatchObject({ current: '1.8.0', target: '1.9.1' });
    } finally {
      published['@zhin.js/core'] = ['1.8.0', '1.9.1'];
    }
  });

  it('says a single Zhin package pinned back by its override must be upgraded through zhin.js', async () => {
    write('package.json', `${JSON.stringify({ name: 'bot', dependencies: { 'zhin.js': '^1.4.0', '@zhin.js/core': '^1.8.0' }, pnpm: { overrides: { '@zhin.js/core': '1.8.0' } } }, null, 2)}\n`);
    write('node_modules/@zhin.js/core/package.json', { name: '@zhin.js/core', version: '1.8.0' });
    const preview = await previewUpdate(root, ['@zhin.js/core@1.9.1'], {
      publishedVersions: lookup,
      packageDependencies: async (name, version) => (name === 'zhin.js' && version === '1.4.0' ? { '@zhin.js/core': '1.8.0' } : undefined),
    });
    expect(preview.overrides.changes).toEqual([]);
    expect(preview.overrides.manual).toEqual([
      '@zhin.js/core@1.9.1 无法单独升级：package.json 的 pnpm.overrides "@zhin.js/core" 会把它钉回 1.8.0——这个包的版本由 zhin.js 的版本决定，zhin update 会失败并回滚；请改为升级 zhin.js，或先手动把 package.json:9 的 "@zhin.js/core" 改成 "1.9.1"',
    ]);
  });

  it('does not sync pnpm overrides in a project that installs with another manager', async () => {
    write('package.json', { name: 'bot', packageManager: 'npm@10.9.0', dependencies: { 'zhin.js': '^1.4.0' }, pnpm: { overrides: { 'zhin.js': '1.4.0' } } });
    const preview = await previewUpdate(root, [], { publishedVersions: lookup, packageDependencies: async () => { throw new Error('not asked'); } });
    expect(preview.overrides).toEqual({ changes: [], manual: [] });
    write('package.json', { name: 'bot', dependencies: { 'zhin.js': '^1.4.0' }, pnpm: { overrides: { 'zhin.js': '1.4.0' } } });
    write('yarn.lock', '');
    expect((await previewUpdate(root, [], { publishedVersions: lookup, packageDependencies: async () => undefined })).overrides).toEqual({ changes: [], manual: [] });
    fs.rmSync(path.join(root, 'yarn.lock'));
    expect((await previewUpdate(root, [], { publishedVersions: lookup, packageDependencies: async () => undefined })).overrides.changes)
      .toEqual([{ file: 'package.json', key: 'zhin.js', from: '1.4.0', to: '1.4.2' }]);
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
