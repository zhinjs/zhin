import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STATE_DIR,
  applyLinkOverrides,
  detectZhinPackages,
  devLink,
  devUnlink,
  describeDuplicateZhinInstances,
  findDuplicateZhinInstances,
  formatDuplicateZhinInstances,
  readWorkspaceEntries,
  resolveWorkspaceClosure,
} from '../src/utils/dev-link.js';

const workspace = [
  { name: 'zhin.js', dir: '/repo/packages/im/zhin', manifest: { dependencies: { '@zhin.js/runtime': 'workspace:*' } } },
  { name: '@zhin.js/runtime', dir: '/repo/packages/im/runtime', manifest: { dependencies: { '@zhin.js/command': 'workspace:^' } } },
  { name: '@zhin.js/command', dir: '/repo/packages/im/command', manifest: {} },
  { name: '@zhin.js/unused', dir: '/repo/x', manifest: {} },
];

let root: string, project: string, repo: string, logs: string[], calls: string[];
const opts = () => ({
  repo,
  workspace: () => workspace,
  build: (names: string[]) => { calls.push(`build:${names.join(',')}`); },
  pack: (entry: { name: string }, dest: string) => {
    const file = `${entry.name.replace('@', '').replace('/', '-')}-0.0.0.tgz`;
    fs.writeFileSync(path.join(dest, file), 'tgz');
    return file;
  },
  install: () => { calls.push('install'); },
  log: (m: string) => logs.push(m),
});
const original = '{\n    "name": "bot",\n    "dependencies": {\n        "zhin.js": "^1.1.7",\n        "@zhin.js/not-here": "^1.0.0",\n        "lodash": "^4"\n    }\n}\n';
const read = (f: string) => fs.readFileSync(path.join(project, f), 'utf8');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-link-test-'));
  repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  project = path.join(root, 'bot');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), original);
  fs.writeFileSync(path.join(project, 'pnpm-lock.yaml'), 'lock: original\n');
  fs.writeFileSync(path.join(project, 'zhin.config.json'), JSON.stringify({configVersion: 2, plugins: {}}));
  logs = []; calls = [];
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('dev link manifest transformation', () => {
  it('detects direct zhin deps and zhin.plugins declarations', () => {
    const manifest = { dependencies: { 'zhin.js': '1', lodash: '1', '@zhin.js/gone': '1' } };
    expect(detectZhinPackages(manifest, new Set(workspace.map((e) => e.name)), {configVersion: 2, plugins: {command: '@zhin.js/command', runtime: '@zhin.js/runtime'}})).toEqual({
      known: ['@zhin.js/command', '@zhin.js/runtime', 'zhin.js'],
      unknown: ['@zhin.js/gone'],
      undeclared: ['@zhin.js/command', '@zhin.js/runtime'],
    });
  });

  it('resolves the workspace closure dependencies-first and tolerates cycles', () => {
    expect(resolveWorkspaceClosure(workspace, ['zhin.js']).map((e) => e.name)).toEqual(['@zhin.js/command', '@zhin.js/runtime', 'zhin.js']);
    const cyc = [
      { name: 'a', dir: '', manifest: { dependencies: { b: 'workspace:*' } } },
      { name: 'b', dir: '', manifest: { dependencies: { a: 'workspace:*' } } },
    ];
    expect(resolveWorkspaceClosure(cyc, ['a']).map((e) => e.name)).toEqual(['b', 'a']);
    expect(() => resolveWorkspaceClosure(workspace, ['nope'])).toThrow(/not found/);
  });

  it('overrides every package in the closure, keeping unrelated overrides', () => {
    const next = applyLinkOverrides(
      { name: 'x', pnpm: { overrides: { semver: '^7' }, other: 1 } },
      [{ name: 'zhin.js' }, { name: '@zhin.js/command' }],
      new Map([['zhin.js', './a.tgz'], ['@zhin.js/command', './b.tgz']]),
    );
    expect(next.pnpm).toEqual({ other: 1, overrides: { semver: '^7', 'zhin.js': 'file:./a.tgz', '@zhin.js/command': 'file:./b.tgz' } });
    expect(() => applyLinkOverrides({}, [{ name: 'zhin.js' }], new Map())).toThrow(/missing/);
  });

  it('links via tarball overrides and unlinks byte-for-byte', () => {
    devLink(project, opts());
    const linked = JSON.parse(read('package.json'));
    expect(linked.pnpm.overrides).toEqual({
      '@zhin.js/command': `file:./${STATE_DIR}/packs/zhin.js-command-0.0.0.tgz`,
      '@zhin.js/runtime': `file:./${STATE_DIR}/packs/zhin.js-runtime-0.0.0.tgz`,
      'zhin.js': `file:./${STATE_DIR}/packs/zhin.js-0.0.0.tgz`,
    });
    expect(read('package.json')).toMatch(/^\{\n {4}"name"/);
    expect(read('.gitignore')).toContain(`${STATE_DIR}/`);
    expect(calls).toEqual(['build:zhin.js', 'install']);
    expect(logs.join('\n')).toContain('@zhin.js/not-here');

    fs.writeFileSync(path.join(project, 'pnpm-lock.yaml'), 'changed');
    expect(devUnlink(project, opts())).toBe(true);
    expect(read('package.json')).toBe(original);
    expect(read('pnpm-lock.yaml')).toBe('lock: original\n');
    expect(fs.existsSync(path.join(project, STATE_DIR))).toBe(false);
    expect(fs.existsSync(path.join(project, '.gitignore'))).toBe(false);
    expect(devUnlink(project, opts())).toBe(false);
  });

  it('refuses preset zhin overrides, projects inside the repo, and edited manifests', () => {
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ dependencies: { 'zhin.js': '1' }, pnpm: { overrides: { 'zhin.js': '1' } } }));
    expect(() => devLink(project, opts())).toThrow(/pnpm\.overrides/);

    fs.writeFileSync(path.join(project, 'package.json'), original);
    const inside = path.join(repo, 'bot');
    fs.mkdirSync(inside);
    fs.writeFileSync(path.join(inside, 'package.json'), original);
    expect(() => devLink(inside, opts())).toThrow(/位于 zhin 仓库内/);

    devLink(project, opts());
    fs.appendFileSync(path.join(project, 'package.json'), '\n');
    expect(() => devUnlink(project, opts())).toThrow(/--force/);
    expect(devUnlink(project, { ...opts(), force: true })).toBe(true);
    expect(read('package.json')).toBe(original);
  });

  it('reads the checkout workspace from pnpm-workspace.yaml', () => {
    fs.writeFileSync(path.join(repo, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/im/*'\n  - 'plugins/{a,b}/*'\n  - '!ignored'\n");
    for (const dir of ['packages/im/zhin', 'plugins/a/p1', 'plugins/b/p2']) {
      fs.mkdirSync(path.join(repo, dir), { recursive: true });
      fs.writeFileSync(path.join(repo, dir, 'package.json'), JSON.stringify({ name: dir.split('/').pop() }));
    }
    expect(readWorkspaceEntries(repo).map((e) => e.name).sort()).toEqual(['p1', 'p2', 'zhin']);
    expect(() => readWorkspaceEntries(project)).toThrow(/pnpm-workspace/);
  });
});

describe('dev link failure recovery', () => {
  const failingPack = () => ({ ...opts(), pack: () => { throw new Error('pack boom'); } });

  it('leaves no partial state when the first link fails while packing', () => {
    expect(() => devLink(project, failingPack())).toThrow(/pack boom/);
    expect(fs.existsSync(path.join(project, STATE_DIR))).toBe(false);
    expect(fs.existsSync(path.join(project, '.gitignore'))).toBe(false);
    expect(read('package.json')).toBe(original);
    devLink(project, opts());
    expect(devUnlink(project, opts())).toBe(true);
  });

  it('keeps an existing link intact when a refresh fails while packing', () => {
    devLink(project, opts());
    const linked = read('package.json');
    expect(() => devLink(project, failingPack())).toThrow(/pack boom/);
    expect(read('package.json')).toBe(linked);
    expect(fs.existsSync(path.join(project, STATE_DIR, 'packs', 'zhin.js-0.0.0.tgz'))).toBe(true);
    expect(devUnlink(project, opts())).toBe(true);
    expect(read('package.json')).toBe(original);
  });

  it('unlink cleans a state dir that has a backup but no state.json', () => {
    const backup = path.join(project, STATE_DIR, 'backup');
    fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(path.join(backup, 'package.json'), original);
    expect(devUnlink(project, opts())).toBe(true);
    expect(fs.existsSync(path.join(project, STATE_DIR))).toBe(false);
    expect(read('package.json')).toBe(original);
  });

  it('unlink refuses a stateless dir when package.json differs from the backup', () => {
    const backup = path.join(project, STATE_DIR, 'backup');
    fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(path.join(backup, 'package.json'), '{"name":"other"}');
    expect(() => devUnlink(project, opts())).toThrow(/state\.json/);
    expect(fs.existsSync(backup)).toBe(true);
  });
});

describe('duplicate zhin instance detection', () => {
  const pkg = (dir: string, manifest: Record<string, unknown>) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  };
  /** pnpm 布局：.pnpm/<id>/node_modules/<name>，依赖是同级符号链接 */
  const store = (id: string, name: string, manifest: Record<string, unknown> = {}) => {
    const dir = path.join(project, 'node_modules/.pnpm', id, 'node_modules', name);
    pkg(dir, { name, version: '1.0.0', ...manifest });
    return dir;
  };
  const top = (name: string, target: string) => {
    const dest = path.join(project, 'node_modules', name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(target, dest, 'dir');
  };
  const sibling = (from: string, name: string, target: string) => {
    const dest = path.join(path.dirname(from), name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(target, dest, 'dir');
  };

  it('returns empty without node_modules', () => {
    expect(findDuplicateZhinInstances(project).size).toBe(0);
  });

  it('is clean when each zhin package resolves once, ignoring unreachable leftovers', () => {
    const core = store('@zhin.js+core@1.0.0', '@zhin.js/core');
    const plugin = store('plug@1.0.0', 'plug', { dependencies: { '@zhin.js/core': '^1' } });
    sibling(plugin, '@zhin.js/core', core);
    top('@zhin.js/core', core);
    top('plug', plugin);
    store('@zhin.js+core@0.9.0', '@zhin.js/core'); // 孤儿历史目录，不可达
    expect(findDuplicateZhinInstances(project).size).toBe(0);
  });

  it('reports a transitive copy of a zhin package', () => {
    const core = store('@zhin.js+core@1.0.0', '@zhin.js/core');
    const oldCore = store('@zhin.js+core@0.9.0', '@zhin.js/core');
    const plugin = store('plug@1.0.0', 'plug', { dependencies: { '@zhin.js/core': '^0.9' } });
    sibling(plugin, '@zhin.js/core', oldCore);
    top('@zhin.js/core', core);
    top('plug', plugin);
    const dups = findDuplicateZhinInstances(project);
    expect([...dups.keys()]).toEqual(['@zhin.js/core']);
    expect(dups.get('@zhin.js/core')).toHaveLength(2);
  });

  it('ignores a stale copy in pnpm\'s hidden hoist directory .pnpm/node_modules (#1250)', () => {
    const core = store('@zhin.js+core@1.2.0', '@zhin.js/core');
    const staleCore = store('@zhin.js+core@1.1.0', '@zhin.js/core');
    // The plugin's peer is not linked into its slot: Node would climb past the slot.
    const plugin = store('plug@1.0.0', 'plug', { peerDependencies: { '@zhin.js/core': '*' } });
    const hoisted = path.join(project, 'node_modules/.pnpm/node_modules/@zhin.js/core');
    fs.mkdirSync(path.dirname(hoisted), { recursive: true });
    fs.symlinkSync(staleCore, hoisted, 'dir');
    top('@zhin.js/core', core);
    top('plug', plugin);
    expect(findDuplicateZhinInstances(project).size).toBe(0);
  });

  it('reports a link:-ed copy outside the project (zhin.js and peers)', () => {
    const npmCopy = store('zhin.js@1.0.0', 'zhin.js');
    const linked = path.join(root, 'checkout/packages/im/zhin');
    pkg(linked, { name: 'zhin.js', version: '1.0.0' });
    const plugin = store('plug@1.0.0', 'plug', { peerDependencies: { 'zhin.js': '*' } });
    sibling(plugin, 'zhin.js', linked);
    top('zhin.js', npmCopy);
    top('plug', plugin);
    expect([...findDuplicateZhinInstances(project).keys()]).toEqual(['zhin.js']);
  });

  it('names who requires each copy: the root project and a workspace member with its specifier (#1250)', () => {
    const current = store('zhin.js@1.4.0', 'zhin.js', { version: '1.4.0' });
    const old = store('zhin.js@1.2.0', 'zhin.js', { version: '1.2.0' });
    pkg(project, { name: 'bot', dependencies: { 'zhin.js': '^1.4.0', foo: 'workspace:*' } });
    fs.writeFileSync(path.join(project, 'pnpm-workspace.yaml'), "packages:\n  - 'plugins/*'\n");
    const member = path.join(project, 'plugins/foo');
    pkg(member, { name: 'foo', dependencies: { 'zhin.js': '~1.2.0' } });
    top('zhin.js', current);
    top('foo', member);
    fs.mkdirSync(path.join(member, 'node_modules'), { recursive: true });
    fs.symlinkSync(old, path.join(member, 'node_modules', 'zhin.js'), 'dir');
    const described = describeDuplicateZhinInstances(project);
    expect([...described.keys()]).toEqual(['zhin.js']);
    const { lines, fixes } = formatDuplicateZhinInstances(described);
    expect(lines).toEqual(['zhin.js ×2：1.2.0 ← plugins/foo ("~1.2.0")；1.4.0 ← 根项目']);
    expect(fixes).toEqual(['把 plugins/foo/package.json 的 zhin.js 改成 ^1.4.0（或运行 zhin migrate，一并升级工作区里的包）']);
  });

  it('names the direct dependency that drags an old copy in, a retired one with its replacement, before overrides (#1250)', () => {
    // The root still declares the retired @zhin.js/config-yaml@1.1.0, which pins old releases.
    const runtime = store('@zhin.js+runtime@1.4.0', '@zhin.js/runtime', { version: '1.4.0' });
    const pluginRuntime = store('@zhin.js+plugin-runtime@1.4.0', '@zhin.js/plugin-runtime', { version: '1.4.0' });
    const oldRuntime = store('@zhin.js+runtime@1.1.0', '@zhin.js/runtime', { version: '1.1.0', dependencies: { '@zhin.js/plugin-runtime': '1.1.9' } });
    const oldPluginRuntime = store('@zhin.js+plugin-runtime@1.1.9', '@zhin.js/plugin-runtime', { version: '1.1.9' });
    const configYaml = store('@zhin.js+config-yaml@1.1.0', '@zhin.js/config-yaml', { version: '1.1.0', dependencies: { '@zhin.js/runtime': '1.1.0' } });
    // Scoped packages sit one level deeper in their pnpm slot (`node_modules/@zhin.js/<name>`).
    sibling(path.dirname(configYaml), '@zhin.js/runtime', oldRuntime);
    sibling(path.dirname(oldRuntime), '@zhin.js/plugin-runtime', oldPluginRuntime);
    pkg(project, { name: 'bot', dependencies: { '@zhin.js/runtime': '^1.4.0', '@zhin.js/plugin-runtime': '^1.4.0', '@zhin.js/config-yaml': '^1.1.0' } });
    top('@zhin.js/runtime', runtime);
    top('@zhin.js/plugin-runtime', pluginRuntime);
    top('@zhin.js/config-yaml', configYaml);

    const described = describeDuplicateZhinInstances(project);
    expect([...described.keys()]).toEqual(['@zhin.js/plugin-runtime', '@zhin.js/runtime']);
    const oldPr = described.get('@zhin.js/plugin-runtime')!.find(copy => copy.version === '1.1.9')!;
    expect(oldPr.origins).toEqual([{
      project: '根项目',
      direct: '@zhin.js/config-yaml@1.1.0',
      directName: '@zhin.js/config-yaml',
      path: ['@zhin.js/config-yaml@1.1.0', '@zhin.js/runtime@1.1.0', '@zhin.js/plugin-runtime@1.1.9'],
    }]);
    const { fixes } = formatDuplicateZhinInstances(described);
    expect(fixes[0]).toBe('根项目 的直接依赖 @zhin.js/config-yaml@1.1.0 拖进了 @zhin.js/plugin-runtime@1.1.9'
      + '（@zhin.js/config-yaml@1.1.0 → @zhin.js/runtime@1.1.0 → @zhin.js/plugin-runtime@1.1.9）：'
      + '已停更并入 @zhin.js/runtime：改用 @zhin.js/runtime 的 YamlConfigDocument（import { YamlConfigDocument } from \'@zhin.js/runtime\'），然后删除 @zhin.js/config-yaml 依赖');
    expect(fixes[1]).toContain('根项目 的直接依赖 @zhin.js/config-yaml@1.1.0 拖进了 @zhin.js/runtime@1.1.0（@zhin.js/config-yaml@1.1.0 → @zhin.js/runtime@1.1.0）');
    // overrides only come last.
    expect(fixes.at(-1)).toBe('以上都处理后仍有重复，再在 package.json 的 pnpm.overrides 中统一 @zhin.js/plugin-runtime、@zhin.js/runtime 的版本');
    expect(fixes.findIndex(fix => fix.includes('overrides'))).toBe(fixes.length - 1);
  });

  it('finds a workspace member\'s copy even when the root does not depend on the member', () => {
    const current = store('zhin.js@1.4.0', 'zhin.js', { version: '1.4.0' });
    const old = store('zhin.js@1.2.0', 'zhin.js', { version: '1.2.0' });
    pkg(project, { name: 'bot', dependencies: { 'zhin.js': '^1.4.0' } });
    fs.writeFileSync(path.join(project, 'pnpm-workspace.yaml'), "packages:\n  - 'plugins/*'\n");
    const member = path.join(project, 'plugins/bar');
    pkg(member, { name: 'bar', dependencies: { 'zhin.js': '1.2.0' } });
    top('zhin.js', current);
    fs.mkdirSync(path.join(member, 'node_modules'), { recursive: true });
    fs.symlinkSync(old, path.join(member, 'node_modules', 'zhin.js'), 'dir');
    const { lines } = formatDuplicateZhinInstances(describeDuplicateZhinInstances(project));
    expect(lines).toEqual(['zhin.js ×2：1.2.0 ← plugins/bar ("1.2.0")；1.4.0 ← 根项目']);
  });
});
