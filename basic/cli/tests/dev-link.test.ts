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
  findDuplicateZhinInstances,
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
  logs = []; calls = [];
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('dev link manifest transformation', () => {
  it('detects direct zhin deps and zhin.plugins declarations', () => {
    const manifest = { dependencies: { 'zhin.js': '1', lodash: '1', '@zhin.js/gone': '1' }, zhin: { plugins: ['@zhin.js/command', { package: '@zhin.js/runtime' }] } };
    expect(detectZhinPackages(manifest, new Set(workspace.map((e) => e.name)))).toEqual({
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
});
