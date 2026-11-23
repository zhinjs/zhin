// `zhin doctor` loads node-pty the way the project's gateway would, in a child process (#1250).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEntryPackageName, confirmsPnpm10, findAncestorWorkspaceFile, nativeModuleFixCommand, planNativeBuildAllowance, probeGatewayNativeModule, syncNativeBuildAllowance, usesPnpm } from '../../src/utils/native-build-deps.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writePackage(dir: string, manifest: Record<string, unknown>, files: Record<string, string>): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
}

/** A project whose gateway (an ESM-only package, like the real one) has `node-pty` next to it. */
function project(nodePty: 'loads' | 'broken' | 'missing', withGateway = true): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-probe-'));
  roots.push(root);
  writePackage(root, { name: 'bot', private: true }, {});
  if (!withGateway) return root;
  const gateway = path.join(root, 'node_modules', '@zhin.js', 'gateway');
  writePackage(gateway, { name: '@zhin.js/gateway', type: 'module', exports: { '.': { import: './lib/index.js' } } }, {});
  fs.mkdirSync(path.join(gateway, 'lib'));
  fs.writeFileSync(path.join(gateway, 'lib', 'index.js'), 'export {};\n');
  if (nodePty === 'missing') return root;
  // Installed next to the gateway, as pnpm lays out an optional dependency (not in the project's root).
  writePackage(path.join(gateway, 'node_modules', 'node-pty'), { name: 'node-pty', main: 'index.js' }, {
    'index.js': nodePty === 'loads'
      ? 'module.exports = { spawn() {} };\n'
      : "throw new Error(\"Cannot find module '../build/Release/pty.node'\");\n",
  });
  return root;
}

describe('probeGatewayNativeModule', () => {
  it('reports ok when node-pty loads from the gateway location', async () => {
    await expect(probeGatewayNativeModule(project('loads'))).resolves.toEqual({ status: 'ok' });
  });

  it('reports the load error when the native binding was not built', async () => {
    const probe = await probeGatewayNativeModule(project('broken'));
    expect(probe).toEqual({ status: 'failed', reason: expect.stringContaining('pty.node') });
  });

  it('reports a missing node-pty as a failure', async () => {
    const probe = await probeGatewayNativeModule(project('missing'));
    expect(probe.status).toBe('failed');
    expect(probe.status === 'failed' && probe.reason).toContain('node-pty');
  });

  it('skips projects without the gateway', async () => {
    await expect(probeGatewayNativeModule(project('loads', false))).resolves.toEqual({ status: 'no-gateway' });
  });
});

describe('nativeModuleFixCommand', () => {
  it('points pnpm projects at allowBuilds and pnpm rebuild, npm projects at npm rebuild', () => {
    const root = project('loads', false);
    expect(usesPnpm(root, {})).toBe(true);
    expect(nativeModuleFixCommand(root, {})).toContain('allowBuilds: { node-pty: true }');
    expect(nativeModuleFixCommand(root, {})).toContain('pnpm rebuild node-pty');
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
    expect(nativeModuleFixCommand(root, {})).toContain('npm rebuild node-pty');
    expect(nativeModuleFixCommand(root, { packageManager: 'pnpm@11.27.1' })).toContain('pnpm rebuild node-pty');
  });
});

describe('creating pnpm-workspace.yaml needs pnpm 10+', () => {
  const gatewayProject = (manifest: Record<string, unknown> = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-plan-'));
    roots.push(root);
    return { root, pkg: { name: 'bot', dependencies: { '@zhin.js/gateway': '^1.0.0' }, ...manifest } };
  };

  it('reads packageManager first, then the installed pnpm version', () => {
    const never = () => { throw new Error('not consulted'); };
    expect(confirmsPnpm10('.', { packageManager: 'pnpm@10.0.0' }, never)).toBe(true);
    expect(confirmsPnpm10('.', { packageManager: 'pnpm@11.2.0+sha512.abc' }, never)).toBe(true);
    expect(confirmsPnpm10('.', { packageManager: 'pnpm@9.15.4' }, never)).toBe(false);
    expect(confirmsPnpm10('.', {}, () => '10.12.1')).toBe(true);
    expect(confirmsPnpm10('.', {}, () => '9.0.2')).toBe(false);
    expect(confirmsPnpm10('.', {}, () => undefined)).toBe(false);
  });

  it('skips the workspace file when pnpm 10+ is not confirmed, and plans it otherwise', () => {
    const unknown = gatewayProject();
    const skipped = planNativeBuildAllowance(unknown.root, unknown.pkg, { pnpmVersion: () => undefined });
    expect(skipped).toMatchObject({ workspaceSkipped: true, changes: [] });
    skipped!.apply();
    expect(fs.existsSync(path.join(unknown.root, 'pnpm-workspace.yaml'))).toBe(false);

    const pnpm10 = gatewayProject();
    const planned = planNativeBuildAllowance(pnpm10.root, pnpm10.pkg, { pnpmVersion: () => '10.30.0' });
    expect(planned?.workspaceSkipped).toBe(false);
    planned!.apply();
    expect(fs.readFileSync(path.join(pnpm10.root, 'pnpm-workspace.yaml'), 'utf8')).toContain('node-pty: true');
  });

  it('still extends package.json#pnpm.onlyBuiltDependencies without a workspace file', () => {
    const { root, pkg } = gatewayProject({ pnpm: { onlyBuiltDependencies: ['esbuild'] } });
    const plan = planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '9.0.2' });
    expect(plan?.workspaceSkipped).toBe(true);
    expect(plan?.changes.map(change => change.file)).toEqual(['package.json', 'package.json', 'package.json']);
  });
});

describe('pnpm 11 placeholder values in allowBuilds', () => {
  it('replaces the "set this to true or false" placeholder with true and keeps an explicit false', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-placeholder-'));
    roots.push(root);
    const file = path.join(root, 'pnpm-workspace.yaml');
    fs.writeFileSync(file, 'allowBuilds:\n  node-pty: set this to true or false\n  ssh2: false\n');
    const pkg = { name: 'bot', packageManager: 'pnpm@11.0.0', dependencies: { '@zhin.js/gateway': '^1.0.0' } };
    const plan = planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '11.0.0' });
    expect(plan?.denied).toEqual([{ name: 'ssh2', source: 'pnpm-workspace.yaml allowBuilds.ssh2' }]);
    expect(plan?.changes).toEqual(expect.arrayContaining([
      { file: 'pnpm-workspace.yaml', setting: 'allowBuilds.node-pty', value: 'true', replaced: 'set this to true or false' },
      { file: 'pnpm-workspace.yaml', setting: 'allowBuilds.cpu-features', value: 'true' },
    ]));
    expect(plan?.changes.some(change => change.setting === 'allowBuilds.ssh2')).toBe(false);
    plan!.apply();
    const written = fs.readFileSync(file, 'utf8');
    expect(written).toContain('node-pty: true');
    expect(written).toContain('ssh2: false');
    expect(written).not.toContain('set this to true or false');
  });
});

describe('a project nested in an enclosing pnpm workspace', () => {
  const nested = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-nested-'));
    roots.push(root);
    const rootFile = path.join(root, 'pnpm-workspace.yaml');
    const original = "packages:\n  - 'bots/*'\n";
    fs.writeFileSync(rootFile, original);
    const dir = path.join(root, 'bots', 'bot');
    fs.mkdirSync(dir, { recursive: true });
    return { root, rootFile, original, dir, pkg: { name: 'bot', packageManager: 'pnpm@11.0.0', dependencies: { '@zhin.js/gateway': '^1.0.0' } } };
  };

  it('finds the nearest ancestor workspace file, stopping at the home directory', () => {
    const { root, rootFile, dir } = nested();
    expect(findAncestorWorkspaceFile(dir, '/nonexistent-home')).toBe(rootFile);
    // The project's own file is not an ancestor.
    expect(findAncestorWorkspaceFile(root, '/nonexistent-home')).toBeUndefined();
    // The search never reaches the home directory or beyond it.
    expect(findAncestorWorkspaceFile(dir, root)).toBeUndefined();
    expect(findAncestorWorkspaceFile(dir, path.join(root, 'bots'))).toBeUndefined();
  });

  it('does not create a workspace file in the project even with pnpm 10+, and points at the root file instead', () => {
    const { rootFile, original, dir, pkg } = nested();
    const probe = vi.fn(() => '11.0.0');
    const plan = planNativeBuildAllowance(dir, pkg, { pnpmVersion: probe, homeDir: '/nonexistent-home' });
    expect(plan).toMatchObject({ workspaceSkipped: true, workspaceSkipReason: { kind: 'nested-workspace', workspaceFile: rootFile }, changes: [] });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      syncNativeBuildAllowance(dir, pkg, false, { pnpmVersion: probe, homeDir: '/nonexistent-home' });
      const output = log.mock.calls.flat().join('\n');
      expect(output).toContain(rootFile);
      expect(output).toContain('allowBuilds: { node-pty: true, ssh2: true, cpu-features: true }');
    } finally { log.mockRestore(); }
    expect(fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))).toBe(false);
    expect(fs.readFileSync(rootFile, 'utf8')).toBe(original);
  });
});

// #1250 migrate-overrides-ignored-builds: an explicit ignoredBuiltDependencies entry is never
// overridden by the gateway's build allowance, in the preview or in the real run.
describe('packages the project lists in ignoredBuiltDependencies', () => {
  const ignoredProject = (manifest: Record<string, unknown>, workspace: string) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-ignored-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), workspace);
    const pkg = { name: 'bot', packageManager: 'pnpm@11.0.0', dependencies: { '@zhin.js/gateway': '^1.0.0' }, ...manifest };
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
    return { root, pkg };
  };
  const run = (root: string, pkg: Record<string, any>, dryRun: boolean) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const changed = syncNativeBuildAllowance(root, pkg, dryRun, { pnpmVersion: () => '11.0.0' });
      return { changed, output: log.mock.calls.flat().join('\n') };
    } finally { log.mockRestore(); }
  };

  it('skips names from package.json#pnpm.ignoredBuiltDependencies in allowBuilds and onlyBuiltDependencies', () => {
    const { root, pkg } = ignoredProject(
      { pnpm: { onlyBuiltDependencies: ['esbuild'], ignoredBuiltDependencies: ['cpu-features', 'ssh2'] } },
      "packages:\n  - '.'\n",
    );
    const plan = planNativeBuildAllowance(root, structuredClone(pkg), { pnpmVersion: () => '11.0.0' });
    expect(plan?.ignored).toEqual([
      { name: 'ssh2', setting: 'ignoredBuiltDependencies', source: 'package.json pnpm.ignoredBuiltDependencies' },
      { name: 'cpu-features', setting: 'ignoredBuiltDependencies', source: 'package.json pnpm.ignoredBuiltDependencies' },
    ]);
    expect(plan?.changes).toEqual([
      { file: 'pnpm-workspace.yaml', setting: 'allowBuilds.node-pty', value: 'true' },
      { file: 'package.json', setting: 'pnpm.onlyBuiltDependencies', value: 'node-pty' },
    ]);
  });

  it('skips names from pnpm-workspace.yaml ignoredBuiltDependencies (and neverBuiltDependencies)', () => {
    const { root, pkg } = ignoredProject({}, 'onlyBuiltDependencies:\n  - esbuild\nignoredBuiltDependencies:\n  - ssh2\nneverBuiltDependencies:\n  - cpu-features\n');
    const plan = planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '11.0.0' });
    expect(plan?.ignored).toEqual([
      { name: 'ssh2', setting: 'ignoredBuiltDependencies', source: 'pnpm-workspace.yaml ignoredBuiltDependencies' },
      { name: 'cpu-features', setting: 'neverBuiltDependencies', source: 'pnpm-workspace.yaml neverBuiltDependencies' },
    ]);
    expect(plan?.changes).toEqual([
      { file: 'pnpm-workspace.yaml', setting: 'allowBuilds.node-pty', value: 'true' },
      { file: 'pnpm-workspace.yaml', setting: 'onlyBuiltDependencies', value: 'node-pty' },
    ]);
  });

  it('prints the skip in the dry run, and the real run writes exactly what the dry run listed', () => {
    const manifest = { pnpm: { onlyBuiltDependencies: ['esbuild'], ignoredBuiltDependencies: ['cpu-features', 'ssh2'] } };
    const workspace = "packages:\n  - '.'\nallowBuilds:\n  esbuild: true\n";
    const preview = ignoredProject(manifest, workspace);
    const dryPkg = structuredClone(preview.pkg);
    const dry = run(preview.root, dryPkg, true);
    expect(dry.output).toContain('[dry-run] ssh2: 已跳过：在 ignoredBuiltDependencies 中（package.json pnpm.ignoredBuiltDependencies）');
    expect(dry.output).toContain('[dry-run] cpu-features: 已跳过：在 ignoredBuiltDependencies 中');
    expect(dry.output).not.toMatch(/\[dry-run\] .*(allowBuilds\.(ssh2|cpu-features)|onlyBuiltDependencies: \+ (ssh2|cpu-features))/u);
    expect(fs.readFileSync(path.join(preview.root, 'pnpm-workspace.yaml'), 'utf8')).toBe(workspace);

    const real = run(preview.root, preview.pkg, false);
    const strip = (text: string) => text.split('\n').map(line => line.replace(/^\s*(\[dry-run\]|·)\s*/u, '')).join('\n');
    expect(strip(real.output)).toBe(strip(dry.output));
    expect(real.changed).toBe(dry.changed);
    expect(preview.pkg).toEqual(dryPkg);
    expect(preview.pkg.pnpm.onlyBuiltDependencies).toEqual(['esbuild', 'node-pty']);
    const written = fs.readFileSync(path.join(preview.root, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).toContain('node-pty: true');
    expect(written).not.toMatch(/ssh2|cpu-features/u);
  });
});

// #1250 review: denials are compared by package name, read from every file pnpm reads, and never
// overridden; values that are not pnpm's placeholder are never rewritten.
describe('build denials the gateway allowance must honour', () => {
  const gatewayPkg = (manifest: Record<string, unknown> = {}) =>
    ({ name: 'bot', packageManager: 'pnpm@11.0.0', dependencies: { '@zhin.js/gateway': '^1.0.0' }, ...manifest });
  const projectWith = (workspace: string | undefined, manifest: Record<string, unknown> = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-deny-'));
    roots.push(root);
    if (workspace !== undefined) fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), workspace);
    return { root, pkg: gatewayPkg(manifest) };
  };
  const sync = (root: string, pkg: Record<string, any>, dryRun: boolean, homeDir?: string) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const changed = syncNativeBuildAllowance(root, pkg, dryRun, { pnpmVersion: () => '11.0.0', ...(homeDir ? { homeDir } : {}) });
      return { changed, output: log.mock.calls.flat().join('\n') };
    } finally { log.mockRestore(); }
  };
  const allowed = (plan: ReturnType<typeof planNativeBuildAllowance>) => [...new Set(plan!.changes.map(change => change.setting === 'onlyBuiltDependencies' || change.setting === 'pnpm.onlyBuiltDependencies' ? change.value : change.setting.slice('allowBuilds.'.length)))];

  it('matches versioned and padded deny-list entries by package name (scoped names too)', () => {
    expect(buildEntryPackageName('ssh2@1.16.0')).toBe('ssh2');
    expect(buildEntryPackageName(' ssh2 ')).toBe('ssh2');
    expect(buildEntryPackageName('@scope/name@^1.2.0')).toBe('@scope/name');
    expect(buildEntryPackageName('@scope/name')).toBe('@scope/name');
    const { root, pkg } = projectWith("packages:\n  - '.'\nignoredBuiltDependencies:\n  - ssh2@1.16.0\n  - ' cpu-features '\n");
    const plan = planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '11.0.0' });
    expect(plan?.ignored).toEqual([
      { name: 'ssh2', setting: 'ignoredBuiltDependencies', source: 'pnpm-workspace.yaml ignoredBuiltDependencies' },
      { name: 'cpu-features', setting: 'ignoredBuiltDependencies', source: 'pnpm-workspace.yaml ignoredBuiltDependencies' },
    ]);
    expect(allowed(plan)).toEqual(['node-pty']);
  });

  it('reads a scalar deny list as one entry and warns', () => {
    const { root, pkg } = projectWith('ignoredBuiltDependencies: ssh2\n');
    const plan = planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '11.0.0' });
    expect(plan?.ignored.map(entry => entry.name)).toEqual(['ssh2']);
    expect(plan?.warnings).toEqual([expect.stringContaining('pnpm-workspace.yaml ignoredBuiltDependencies 是单个字符串而不是列表')]);
    expect(allowed(plan)).toEqual(['node-pty', 'cpu-features']);
    expect(sync(root, pkg, true).output).toContain('[dry-run] pnpm-workspace.yaml ignoredBuiltDependencies 是单个字符串');
  });

  it('counts a versioned allowBuilds key set to false as a denial and adds no bare key', () => {
    const { root, pkg } = projectWith("allowBuilds:\n  'ssh2@1.16.0': false\n  'cpu-features@0.0.10': true\n");
    const plan = planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '11.0.0' });
    expect(plan?.denied).toEqual([{ name: 'ssh2', source: 'pnpm-workspace.yaml allowBuilds.ssh2@1.16.0' }]);
    // The versioned `true` is the project's own decision: no bare key widens it.
    expect(plan?.changes).toEqual([{ file: 'pnpm-workspace.yaml', setting: 'allowBuilds.node-pty', value: 'true' }]);
    expect(sync(root, structuredClone(pkg), true).output).toContain('  [dry-run] pnpm-workspace.yaml allowBuilds.ssh2@1.16.0 为 false（项目已拒绝），保留');
    plan!.apply();
    const written = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).not.toMatch(/^ {2}ssh2: /mu);
    expect(written).toContain("'ssh2@1.16.0': false");
  });

  it.each([
    ['a quoted "false"', "  ssh2: 'false'\n", 'false'],
    ['a YAML 1.1 no', '  ssh2: no\n', 'no'],
    ['a number', '  ssh2: 0\n', '0'],
  ])('leaves %s unchanged, warns and adds it to no allow list', (_label, entry, value) => {
    const workspace = `onlyBuiltDependencies:\n  - esbuild\nallowBuilds:\n${entry}`;
    const { root, pkg } = projectWith(workspace);
    const plan = planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '11.0.0' });
    expect(plan?.undecided).toEqual([{ name: 'ssh2', source: 'pnpm-workspace.yaml allowBuilds.ssh2', value }]);
    expect(allowed(plan)).toEqual(['node-pty', 'cpu-features']);
    const { output } = sync(root, pkg, false);
    expect(output).toContain(`! pnpm-workspace.yaml allowBuilds.ssh2 的值 ${JSON.stringify(value)} 不是布尔值`);
    const written = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).toContain(entry.trimEnd());
    expect(written).not.toMatch(/- ssh2/u);
  });

  it('replaces an empty allowBuilds value (null) like the placeholder', () => {
    const { root, pkg } = projectWith('allowBuilds:\n  node-pty:\n  ssh2: true\n  cpu-features: true\n');
    const plan = planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '11.0.0' });
    expect(plan?.changes).toEqual([{ file: 'pnpm-workspace.yaml', setting: 'allowBuilds.node-pty', value: 'true' }]);
  });

  it('reports a denied package that an allow list names, and edits neither', () => {
    const workspace = "allowBuilds:\n  ssh2: true\nonlyBuiltDependencies:\n  - cpu-features\n";
    const { root, pkg } = projectWith(workspace, { pnpm: { ignoredBuiltDependencies: ['ssh2', 'cpu-features@0.0.10'] } });
    const plan = planNativeBuildAllowance(root, structuredClone(pkg), { pnpmVersion: () => '11.0.0' });
    expect(plan?.conflicts).toEqual([
      { name: 'ssh2', deniedBy: ['package.json pnpm.ignoredBuiltDependencies'], allowedBy: ['pnpm-workspace.yaml allowBuilds.ssh2: true'] },
      { name: 'cpu-features', deniedBy: ['package.json pnpm.ignoredBuiltDependencies（cpu-features@0.0.10）'], allowedBy: ['pnpm-workspace.yaml onlyBuiltDependencies'] },
    ]);
    const { output } = sync(root, pkg, false);
    expect(output).toContain('! ssh2: 冲突——package.json pnpm.ignoredBuiltDependencies 禁止构建，但 pnpm-workspace.yaml allowBuilds.ssh2: true 允许构建');
    expect(output).toContain('pnpm 11 只读 allowBuilds（false 优先于 true）');
    expect(output).toContain('请自行决定保留哪一处');
    expect(output).not.toContain('不加入任何允许名单');
    expect(output).not.toMatch(/(ssh2|cpu-features): 已跳过/u);
    const written = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).toContain('ssh2: true');
    expect(written).toContain('- cpu-features');
    expect(pkg.pnpm.ignoredBuiltDependencies).toEqual(['ssh2', 'cpu-features@0.0.10']);
  });

  it('reports allowBuilds: false next to onlyBuiltDependencies as a conflict too', () => {
    const { root, pkg } = projectWith('allowBuilds:\n  ssh2: false\n', { pnpm: { onlyBuiltDependencies: ['ssh2'] } });
    const plan = planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '11.0.0' });
    expect(plan?.conflicts).toEqual([
      { name: 'ssh2', deniedBy: ['pnpm-workspace.yaml allowBuilds.ssh2: false'], allowedBy: ['package.json pnpm.onlyBuiltDependencies'] },
    ]);
    expect(pkg.pnpm.onlyBuiltDependencies).toEqual(['ssh2', 'node-pty', 'cpu-features']);
  });

  it('honours package.json#pnpm.neverBuiltDependencies', () => {
    const { root, pkg } = projectWith("packages:\n  - '.'\n", { pnpm: { neverBuiltDependencies: ['node-pty'] } });
    const plan = planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '11.0.0' });
    expect(plan?.ignored).toEqual([{ name: 'node-pty', setting: 'neverBuiltDependencies', source: 'package.json pnpm.neverBuiltDependencies' }]);
    expect(allowed(plan)).toEqual(['ssh2', 'cpu-features']);
    expect(sync(root, pkg, true).output).toContain('[dry-run] node-pty: 已跳过：在 neverBuiltDependencies 中（package.json pnpm.neverBuiltDependencies）');
  });

  it('skips allowBuilds for an onlyBuiltDependencies list only when packageManager pins pnpm < 11, not on the local pnpm version', () => {
    const settings = (plan: ReturnType<typeof planNativeBuildAllowance>) => plan!.changes.map(change => change.setting);
    const workspaceText = "packages:\n  - '.'\nonlyBuiltDependencies:\n  - esbuild\n";
    // No pin, local pnpm 10: a deployment or CI may run pnpm 11, which reads allowBuilds only.
    const unpinned = projectWith(workspaceText, { packageManager: undefined });
    expect(settings(planNativeBuildAllowance(unpinned.root, unpinned.pkg, { pnpmVersion: () => '10.30.0' }))).toEqual(expect.arrayContaining([
      'allowBuilds.node-pty', 'allowBuilds.ssh2', 'allowBuilds.cpu-features',
    ]));
    // pnpm 10 pinned: the list is what pnpm 10 builds from, no allowBuilds key.
    const pinned = projectWith(workspaceText, { packageManager: 'pnpm@10.30.0' });
    const plan = planNativeBuildAllowance(pinned.root, pinned.pkg, { pnpmVersion: () => '11.0.0' });
    expect(settings(plan).filter(setting => setting.startsWith('allowBuilds.'))).toEqual([]);
    expect(plan?.allowedByOnlyBuilt.map(entry => entry.name)).toEqual(['node-pty', 'ssh2', 'cpu-features']);
  });

  it('creates onlyBuiltDependencies for pnpm < 10.26 without the denied packages', () => {
    const { root, pkg } = projectWith("packages:\n  - '.'\nignoredBuiltDependencies:\n  - cpu-features\n", { packageManager: 'pnpm@10.12.1' });
    const plan = planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '10.12.1' });
    expect(plan?.changes.filter(change => change.setting === 'onlyBuiltDependencies').map(change => change.value)).toEqual(['node-pty', 'ssh2']);
    plan!.apply();
    const written = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).toContain('onlyBuiltDependencies:\n  - node-pty\n  - ssh2\n');
    expect(written.split('onlyBuiltDependencies:')[1]).not.toContain('cpu-features');
    expect(written).not.toContain('cpu-features: true');
  });

  it('reads the enclosing workspace root\'s denials and leaves them out of the hint', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-nested-deny-'));
    roots.push(root);
    const rootFile = path.join(root, 'pnpm-workspace.yaml');
    fs.writeFileSync(rootFile, "packages:\n  - 'bots/*'\nignoredBuiltDependencies:\n  - ssh2@1.16.0\nallowBuilds:\n  cpu-features: false\n");
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'mono', pnpm: { neverBuiltDependencies: ['esbuild'] } }));
    const dir = path.join(root, 'bots', 'bot');
    fs.mkdirSync(dir, { recursive: true });
    const pkg = gatewayPkg();
    const plan = planNativeBuildAllowance(dir, pkg, { pnpmVersion: () => '11.0.0', homeDir: '/nonexistent-home' });
    expect(plan).toMatchObject({
      workspaceSkipped: true,
      wanted: ['node-pty'],
      ignored: [{ name: 'ssh2', setting: 'ignoredBuiltDependencies', source: `${rootFile} ignoredBuiltDependencies` }],
      denied: [{ name: 'cpu-features', source: `${rootFile} allowBuilds.cpu-features` }],
    });
    const { output } = sync(dir, pkg, false, '/nonexistent-home');
    expect(output).toContain(`请在 ${rootFile} 中加入 allowBuilds: { node-pty: true }`);
    expect(output).not.toMatch(/allowBuilds: \{[^}]*(ssh2|cpu-features)/u);
  });

  // #1250 B-1..B-5 (batch 64).
  const nestedProject = (rootFiles: Record<string, string>, member: Record<string, unknown> = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-nested-b64-'));
    roots.push(root);
    for (const [name, content] of Object.entries(rootFiles)) fs.writeFileSync(path.join(root, name), content);
    const dir = path.join(root, 'bots', 'bot');
    fs.mkdirSync(dir, { recursive: true });
    return { root, dir, pkg: gatewayPkg(member) };
  };

  it('keeps undecided values in package.json#pnpm.allowBuilds off every allow list (B-1)', () => {
    const { root, pkg } = projectWith('allowBuilds:\n  esbuild: true\n', { pnpm: { allowBuilds: { ssh2: 'yes' }, onlyBuiltDependencies: ['esbuild'] } });
    const plan = planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '11.0.0' });
    expect(plan?.undecided).toEqual([{ name: 'ssh2', source: 'package.json pnpm.allowBuilds.ssh2', value: 'yes' }]);
    expect(plan?.wanted).toEqual(['node-pty', 'cpu-features']);
    expect(allowed(plan)).toEqual(['node-pty', 'cpu-features']);
    expect(pkg.pnpm.onlyBuiltDependencies).toEqual(['esbuild', 'node-pty', 'cpu-features']);
  });

  it('reads undecided values from the enclosing workspace yaml and package.json, and never writes a member\'s onlyBuiltDependencies (B-1)', () => {
    const { dir, pkg, root } = nestedProject({
      'pnpm-workspace.yaml': "packages:\n  - 'bots/*'\nallowBuilds:\n  node-pty: 'true'\n",
      'package.json': JSON.stringify({ name: 'mono', pnpm: { allowBuilds: { 'cpu-features@0.0.10': 1 } } }),
    }, { pnpm: { onlyBuiltDependencies: ['esbuild'] } });
    const plan = planNativeBuildAllowance(dir, pkg, { pnpmVersion: () => '11.0.0', homeDir: '/nonexistent-home' });
    expect(plan?.undecided).toEqual([
      { name: 'node-pty', source: `${path.join(root, 'pnpm-workspace.yaml')} allowBuilds.node-pty`, value: 'true' },
      { name: 'cpu-features', source: `${path.join(root, 'package.json')} pnpm.allowBuilds.cpu-features@0.0.10`, value: '1' },
    ]);
    expect(plan?.wanted).toEqual(['ssh2']);
    expect(plan?.changes).toEqual([]);
    expect(pkg.pnpm.onlyBuiltDependencies).toEqual(['esbuild']);
    expect(plan?.warnings).toEqual([expect.stringContaining('package.json pnpm.onlyBuiltDependencies 未修改：项目是')]);
    const { changed, output } = sync(dir, pkg, false, '/nonexistent-home');
    expect(changed).toBe(false);
    expect(output).toContain('pnpm 不读成员的这个列表');
    expect(output).toContain('allowBuilds: { ssh2: true }');
    expect(output).not.toMatch(/allowBuilds: \{[^}]*(node-pty|cpu-features)/u);
  });

  it('trims the name part of a spaced versioned entry (B-2)', () => {
    expect(buildEntryPackageName('ssh2 @1.16.0')).toBe('ssh2');
    expect(buildEntryPackageName(' @scope/name @^1 ')).toBe('@scope/name');
    const { root, pkg } = projectWith('ignoredBuiltDependencies:\n  - "ssh2 @1.16.0"\n');
    expect(planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '11.0.0' })?.ignored.map(entry => entry.name)).toEqual(['ssh2']);
  });

  it('warns about an unparsable enclosing package.json (B-3)', () => {
    const { dir, pkg, root } = nestedProject({ 'pnpm-workspace.yaml': "packages:\n  - 'bots/*'\n", 'package.json': '{ not json' });
    const plan = planNativeBuildAllowance(dir, pkg, { pnpmVersion: () => '11.0.0', homeDir: '/nonexistent-home' });
    expect(plan?.warnings).toEqual([expect.stringContaining(`${path.join(root, 'package.json')} 不是有效的 JSON`)]);
  });

  it('abandons the plan with a readable hint when the enclosing workspace file cannot be read (B-3)', () => {
    const { dir, pkg, root } = nestedProject({});
    // A directory where the file is expected: reading it throws (EISDIR), like EACCES would.
    fs.mkdirSync(path.join(root, 'pnpm-workspace.yaml'));
    const reasons: string[] = [];
    expect(planNativeBuildAllowance(dir, pkg, { pnpmVersion: () => '11.0.0', homeDir: '/nonexistent-home', onAbandon: reason => reasons.push(reason) })).toBeUndefined();
    expect(reasons).toEqual([expect.stringContaining(`无法读取 ${path.join(root, 'pnpm-workspace.yaml')}（EISDIR）`)]);
    const { changed, output } = sync(dir, pkg, false, '/nonexistent-home');
    expect(changed).toBe(false);
    expect(output).toContain('未检查原生依赖构建许可，也不做任何修改');
  });

  it('abandons the plan with a hint when a workspace file cannot be parsed (B-3)', () => {
    const { root, pkg } = projectWith('allowBuilds: [\n');
    const reasons: string[] = [];
    expect(planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '11.0.0', onAbandon: reason => reasons.push(reason) })).toBeUndefined();
    expect(reasons).toEqual([expect.stringContaining('pnpm-workspace.yaml 无法解析')]);
  });

  it('leaves a placeholder under a key with surrounding whitespace alone and adds no second key (B-4)', () => {
    const { root, pkg } = projectWith("allowBuilds:\n  ' node-pty ': set this to true or false\n  ssh2: true\n  cpu-features: true\n");
    const plan = planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '11.0.0' });
    expect(plan?.changes).toEqual([]);
    expect(plan?.warnings).toEqual([expect.stringContaining('allowBuilds 的键 " node-pty " 带首尾空白')]);
    sync(root, pkg, false);
    const written = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).not.toMatch(/^ {2}node-pty:/mu);
    expect(written).toContain("' node-pty ': set this to true or false");
  });

  it('warns about a non-map allowBuilds and an onlyBuiltDependenciesFile, and changes neither (B-5)', () => {
    const { root, pkg } = projectWith('allowBuilds: true\nonlyBuiltDependenciesFile: build-allow.json\n');
    const plan = planNativeBuildAllowance(root, pkg, { pnpmVersion: () => '11.0.0' });
    expect(plan?.warnings).toEqual([
      expect.stringContaining('pnpm-workspace.yaml onlyBuiltDependenciesFile 指向 build-allow.json：zhin migrate 不会读取或修改该文件'),
      expect.stringContaining('pnpm-workspace.yaml allowBuilds 是 true，不是「包名: true/false」的映射'),
    ]);
    expect(plan?.changes).toEqual([]);
    const before = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(sync(root, pkg, false).output).toContain('allowBuilds is not a map');
    expect(fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(before);
  });
});
