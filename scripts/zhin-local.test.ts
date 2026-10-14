import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectZhinPackages, link, unlink, STATE_DIR } from './zhin-local.mjs';

const workspace = [
  { name: 'zhin.js', dir: '/repo/packages/im/zhin', manifest: { dependencies: { '@zhin.js/runtime': 'workspace:*' } } },
  { name: '@zhin.js/runtime', dir: '/repo/packages/im/runtime', manifest: { dependencies: { '@zhin.js/command': 'workspace:^' } } },
  { name: '@zhin.js/command', dir: '/repo/packages/im/command', manifest: {} },
  { name: '@zhin.js/unused', dir: '/repo/x', manifest: {} },
];

let root: string, project: string, logs: string[], calls: string[];
const opts = () => ({
  repo: path.join(root, 'repo'),
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
const original = '{\n    "name": "bot",\n    "dependencies": {\n        "zhin.js": "^1.1.7",\n        "@zhin.js/command": "^1.1.5",\n        "@zhin.js/not-here": "^1.0.0",\n        "lodash": "^4"\n    }\n}\n';
const lock = 'lockfileVersion: 9.0\n# original\n';
const read = (f: string) => fs.readFileSync(path.join(project, f), 'utf8');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-local-test-'));
  fs.mkdirSync(path.join(root, 'repo'));
  project = path.join(root, 'bot');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), original);
  fs.writeFileSync(path.join(project, 'pnpm-lock.yaml'), lock);
  logs = []; calls = [];
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('zhin:local', () => {
  it('detects direct zhin dependencies and separates unknown ones', () => {
    expect(detectZhinPackages(JSON.parse(original), new Set(workspace.map((e) => e.name))))
      .toEqual({ known: ['@zhin.js/command', 'zhin.js'], unknown: ['@zhin.js/not-here'] });
  });

  it('links the whole closure via tarball overrides and unlinks byte-for-byte', () => {
    link(project, opts());
    const linked = JSON.parse(read('package.json'));
    expect(linked.pnpm.overrides).toEqual({
      '@zhin.js/command': `file:./${STATE_DIR}/packs/zhin.js-command-0.0.0.tgz`,
      '@zhin.js/runtime': `file:./${STATE_DIR}/packs/zhin.js-runtime-0.0.0.tgz`,
      'zhin.js': `file:./${STATE_DIR}/packs/zhin.js-0.0.0.tgz`,
    });
    expect(read('package.json')).toMatch(/^\{\n {4}"name"/);
    expect(calls).toEqual(['build:@zhin.js/command,zhin.js', 'install']);
    expect(logs.join('\n')).toContain('@zhin.js/not-here');

    fs.writeFileSync(path.join(project, 'pnpm-lock.yaml'), 'changed by install');
    expect(unlink(project, opts())).toBe(true);
    expect(read('package.json')).toBe(original);
    expect(read('pnpm-lock.yaml')).toBe(lock);
    expect(fs.existsSync(path.join(project, STATE_DIR))).toBe(false);
  });

  it('is idempotent: relinking refreshes without re-backing up, unlink twice is a no-op', () => {
    link(project, opts());
    const first = read('package.json');
    link(project, opts());
    expect(read('package.json')).toBe(first);
    expect(fs.readFileSync(path.join(project, STATE_DIR, 'backup/package.json'), 'utf8')).toBe(original);
    unlink(project, opts());
    expect(unlink(project, opts())).toBe(false);
    expect(read('package.json')).toBe(original);
  });

  it('removes a lockfile that did not exist before link', () => {
    fs.rmSync(path.join(project, 'pnpm-lock.yaml'));
    link(project, opts());
    fs.writeFileSync(path.join(project, 'pnpm-lock.yaml'), 'new');
    unlink(project, opts());
    expect(fs.existsSync(path.join(project, 'pnpm-lock.yaml'))).toBe(false);
  });

  it('refuses unsafe or unknown states', () => {
    link(project, opts());
    fs.appendFileSync(path.join(project, 'package.json'), ' ');
    expect(() => unlink(project, opts())).toThrow(/link 之后被修改/);
    expect(() => link(project, opts())).toThrow(/link 之后被修改/);

    fs.rmSync(path.join(project, STATE_DIR, 'state.json'));
    expect(() => unlink(project, opts())).toThrow(/状态未知/);
    expect(() => link(project, opts())).toThrow(/状态未知/);
  });

  it('refuses projects without zhin deps, with existing zhin overrides, or inside the repo', () => {
    fs.writeFileSync(path.join(project, 'package.json'), '{"dependencies":{"lodash":"^4"}}');
    expect(() => link(project, opts())).toThrow(/未直接依赖/);
    fs.writeFileSync(path.join(project, 'package.json'), '{"dependencies":{"zhin.js":"^1"},"pnpm":{"overrides":{"zhin.js":"link:../x"}}}');
    expect(() => link(project, opts())).toThrow(/pnpm.overrides/);
    expect(fs.existsSync(path.join(project, STATE_DIR))).toBe(false);
    const inner = path.join(root, 'repo', 'examples', 'b');
    fs.mkdirSync(inner, { recursive: true });
    fs.writeFileSync(path.join(inner, 'package.json'), original);
    expect(() => link(inner, opts())).toThrow(/zhin 仓库内/);
  });
});
