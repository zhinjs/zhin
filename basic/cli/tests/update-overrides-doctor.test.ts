/**
 * #1250 update-overrides-not-synced (acceptance): a project that pins its Zhin packages with
 * `pnpm.overrides` runs one `zhin update`; afterwards `zhin doctor`'s 「Zhin 包单实例」 check
 * (`describeDuplicateZhinInstances`) passes, the overrides follow the upgraded versions and the
 * non-Zhin overrides stay as they were.
 *
 * The package manager is a small pnpm stand-in: a fake registry, the `.pnpm` store layout with
 * symlinks, root and `parent>name` overrides, `add` (an explicit root spec wins over the root's
 * override, as pnpm does), `update` (newest in range unless overridden) and `install`.
 */
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GatewayPackageService, type GatewayPackageManager } from '@zhin.js/gateway/packages';
import { semver } from '../src/plugin-check/semver.js';
import { describeDuplicateZhinInstances, formatDuplicateZhinInstances } from '../src/utils/dev-link.js';
import { runPackageOperationDirect, type Output } from '../src/utils/gateway.js';
import { previewUpdate, renderUpdatePreview } from '../src/utils/update-preview.js';

/** name → version → exact dependencies (the shape of the real 1.6.0 → 1.7.0 release). */
const REGISTRY: Record<string, Record<string, Record<string, string>>> = {
  'zhin.js': {
    '1.6.0': { '@zhin.js/core': '1.11.0', '@zhin.js/command': '1.4.0', '@zhin.js/kernel': '1.3.0' },
    '1.7.0': { '@zhin.js/core': '1.12.0', '@zhin.js/command': '1.4.1', '@zhin.js/kernel': '1.4.0' },
  },
  '@zhin.js/core': {
    '1.11.0': { '@zhin.js/kernel': '1.3.0', '@zhin.js/command': '1.4.0' },
    '1.12.0': { '@zhin.js/kernel': '1.4.0', '@zhin.js/command': '1.4.1' },
  },
  '@zhin.js/command': { '1.4.0': { '@zhin.js/kernel': '1.3.0' }, '1.4.1': { '@zhin.js/kernel': '1.4.0' } },
  '@zhin.js/kernel': { '1.3.0': {}, '1.4.0': {} },
  '@types/node': { '22.0.0': {}, '22.5.0': {} },
};

type Json = Record<string, any>;
const readJson = (file: string): Json => JSON.parse(fs.readFileSync(file, 'utf8')) as Json;
const nameOf = (spec: string) => { const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0); return at < 0 ? spec : spec.slice(0, at); };

function storeDir(root: string, name: string, version: string): string {
  return path.join(root, 'node_modules/.pnpm', `${name.replace('/', '+')}@${version}`, 'node_modules', name);
}

function link(target: string, at: string): void {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.rmSync(at, { recursive: true, force: true });
  fs.symlinkSync(target, at, 'dir');
}

/** pnpm stand-in (see the file comment). `lock.json` keeps the root resolutions between runs. */
function fakePnpm(calls: string[]): GatewayPackageManager {
  return async (args, root, output) => {
    calls.push(args.join(' '));
    output('stdout', `$ pnpm ${args.join(' ')}\n`);
    const [command, ...rest] = args;
    const specs = rest.filter(arg => !arg.startsWith('-'));
    const manifest = readJson(path.join(root, 'package.json'));
    const overrides: Record<string, string> = manifest.pnpm?.overrides ?? {};
    const lockFile = path.join(root, 'lock.json');
    const lock: Record<string, string> = fs.existsSync(lockFile) ? readJson(lockFile) : {};
    const deps: Record<string, string> = { ...manifest.dependencies, ...manifest.devDependencies };
    const newest = (name: string, range: string) => semver.maxSatisfying(Object.keys(REGISTRY[name] ?? {}), range) ?? undefined;
    const explicit = new Map<string, string>();
    if (command === 'add') {
      for (const spec of specs) {
        const name = nameOf(spec);
        const version = spec.slice(name.length + 1) || newest(name, '*')!;
        explicit.set(name, version);
        manifest.dependencies = { ...manifest.dependencies, [name]: args.includes('--save-exact') ? version : `^${version}` };
        deps[name] = manifest.dependencies[name];
      }
    }
    const updating = command === 'update' ? (specs.length ? new Set(specs) : new Set(Object.keys(deps))) : new Set<string>();
    const rootVersion = (name: string, range: string): string => {
      if (explicit.has(name)) return explicit.get(name)!;
      if (overrides[name]) return newest(name, overrides[name])!;
      if (!updating.has(name) && lock[name] && semver.satisfies(lock[name], range)) return lock[name];
      return newest(name, range)!;
    };
    const childVersion = (parent: string, name: string, spec: string): string =>
      newest(name, overrides[`${parent}>${name}`] ?? overrides[name] ?? spec)!;

    fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });
    const placed = new Set<string>();
    const place = (name: string, version: string): string => {
      const dir = storeDir(root, name, version);
      if (placed.has(dir)) return dir;
      placed.add(dir);
      fs.mkdirSync(dir, { recursive: true });
      const dependencies = REGISTRY[name]![version]!;
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, dependencies }));
      for (const [dep, spec] of Object.entries(dependencies)) {
        const depDir = place(dep, childVersion(name, dep, spec));
        link(depDir, path.join(dir, '..', ...(name.startsWith('@') ? ['..'] : []), dep));
      }
      return dir;
    };
    const resolved: Record<string, string> = {};
    for (const [name, range] of Object.entries(deps)) {
      resolved[name] = rootVersion(name, range);
      link(place(name, resolved[name]), path.join(root, 'node_modules', name));
      if (command === 'update' && updating.has(name) && !overrides[name]) {
        for (const field of ['dependencies', 'devDependencies']) {
          if (manifest[field]?.[name]?.startsWith('^')) manifest[field][name] = `^${resolved[name]}`;
        }
      }
    }
    fs.writeFileSync(lockFile, JSON.stringify(resolved));
    fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  };
}

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function lockedProject(overrides: Record<string, string>): Promise<{ root: string; calls: string[]; packages: GatewayPackageService }> {
  const root = fs.realpathSync(await mkdtemp(path.join(os.tmpdir(), 'zhin-update-overrides-')));
  dirs.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'bot', private: true, type: 'module',
    dependencies: { 'zhin.js': '^1.6.0', '@zhin.js/core': '^1.11.0' },
    devDependencies: { '@types/node': '^22.0.0' },
    pnpm: { overrides },
    zhin: { protocol: 1, type: 'plugin', engine: '^1.0.0', runtime: 'trusted', plugins: [] },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
  const calls: string[] = [];
  const pm = fakePnpm(calls);
  await pm(['install'], root, () => undefined);
  // The locked baseline: one copy of each Zhin package, all on the 1.6.0 release; @types/node old.
  fs.writeFileSync(path.join(root, 'lock.json'), JSON.stringify({ ...readJson(path.join(root, 'lock.json')), '@types/node': '22.0.0' }));
  await pm(['install'], root, () => undefined);
  calls.length = 0;
  return { root, calls, packages: new GatewayPackageService({ projectRoot: root, packageManager: pm, hasOwner: () => true }) };
}

const quiet = (): Output & { text: () => string } => {
  let text = '';
  return { out: (value) => { text += value; }, err: (value) => { text += value; }, text: () => text };
};

/** What `zhin doctor` reports for 「Zhin 包单实例」. */
function doctorSingleInstance(root: string): { ok: boolean; lines: string[] } {
  const duplicates = describeDuplicateZhinInstances(root);
  return { ok: duplicates.size === 0, lines: formatDuplicateZhinInstances(duplicates).lines };
}

const LOCKS = { 'zhin.js': '1.6.0', '@zhin.js/core': '1.11.0', '@zhin.js/command': '1.4.0', '@zhin.js/kernel': '~1.3.0', 'left-pad': '1.3.0' };
/** The locks of the reported project: zhin.js, core and command only (the kernel follows them). */
const PARTIAL_LOCKS = { 'zhin.js': '1.6.0', '@zhin.js/core': '1.11.0', '@zhin.js/command': '1.4.0', 'left-pad': '1.3.0' };

describe.runIf(process.platform !== 'win32')('zhin update with pnpm.overrides → zhin doctor (#1250 update-overrides-not-synced)', () => {
  it('starts from a locked project the doctor accepts', async () => {
    const { root } = await lockedProject(LOCKS);
    expect(doctorSingleInstance(root)).toEqual({ ok: true, lines: [] });
    expect(fs.realpathSync(path.join(root, 'node_modules/zhin.js'))).toContain('zhin.js@1.6.0');
  });

  it('without syncing, an exact zhin.js update next to stale overrides leaves two copies (the reported bug)', async () => {
    const { root } = await lockedProject(PARTIAL_LOCKS);
    // What `pnpm add zhin.js@1.7.0` did before the fix: the overrides kept the old dependencies.
    await fakePnpm([])(['add', 'zhin.js@1.7.0'], root, () => undefined);
    const doctor = doctorSingleInstance(root);
    expect(doctor.ok).toBe(false);
    expect(doctor.lines.join('\n')).toContain('@zhin.js/kernel ×2');
  });

  it.each([
    ['zhin update', 'all' as const, LOCKS],
    ['zhin update zhin.js@1.7.0', ['zhin.js@1.7.0'], LOCKS],
    ['zhin update (partial locks)', 'all' as const, PARTIAL_LOCKS],
    ['zhin update zhin.js@1.7.0 (partial locks)', ['zhin.js@1.7.0'], PARTIAL_LOCKS],
  ])('%s syncs the Zhin overrides, leaves the others, and the doctor check passes', async (_label, packages, locks) => {
    const { root, calls, packages: service } = await lockedProject(locks);
    const output = quiet();
    const result = await runPackageOperationDirect({ root }, { operation: 'update', packages }, output, service);
    expect(result).toMatchObject({ ok: true, status: 'succeeded' });
    const manifest = readJson(path.join(root, 'package.json'));
    const synced: Record<string, string> = { 'zhin.js': '1.7.0', '@zhin.js/core': '1.12.0', '@zhin.js/command': '1.4.1', '@zhin.js/kernel': '~1.4.0', 'left-pad': '1.3.0' };
    expect(manifest.pnpm.overrides).toEqual(Object.fromEntries(Object.keys(locks).map(key => [key, synced[key]])));
    // Key order is kept.
    expect(Object.keys(manifest.pnpm.overrides)).toEqual(Object.keys(locks));
    expect(fs.realpathSync(path.join(root, 'node_modules/zhin.js'))).toContain('zhin.js@1.7.0');
    expect(doctorSingleInstance(root)).toEqual({ ok: true, lines: [] });
    // Released before the package manager, pinned after it, installed once with the pins.
    expect(calls.at(-1)).toBe('install --no-frozen-lockfile');
    expect(output.text()).toContain('同步 overrides：package.json 的 pnpm.overrides "@zhin.js/core": 1.11.0 → 1.12.0');
  });

  it('rolls the overrides back with the rest when the update fails', async () => {
    const { root, packages: service } = await lockedProject(LOCKS);
    const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    const failing = new GatewayPackageService({
      projectRoot: root, hasOwner: () => true,
      packageManager: async (args, projectRoot, output) => {
        if (args[0] === 'install' && fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8') !== before) throw new Error('registry down');
        await fakePnpm([])(args, projectRoot, output);
      },
    });
    void service;
    const result = await runPackageOperationDirect({ root }, { operation: 'update', packages: 'all' }, quiet(), failing);
    expect(result).toMatchObject({ ok: false, status: 'rolledBack', failedPhase: 'package-manager' });
    expect(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).toBe(before);
    expect(doctorSingleInstance(root).ok).toBe(true);
  });

  it('names the override lines it cannot sync instead of guessing', async () => {
    const { root, packages: service } = await lockedProject({ ...LOCKS, '@zhin.js/core@<1.12': '1.11.0' });
    const output = quiet();
    await runPackageOperationDirect({ root }, { operation: 'update', packages: 'all' }, output, service);
    expect(readJson(path.join(root, 'package.json')).pnpm.overrides['@zhin.js/core@<1.12']).toBe('1.11.0');
    expect(output.text()).toMatch(/请手动修改 package\.json:\d+（package\.json 的 pnpm\.overrides）"@zhin\.js\/core@<1\.12": "1\.11\.0"/u);
  });

  it('dry-run shows the same override changes and groups Zhin packages first', async () => {
    const { root } = await lockedProject(LOCKS);
    const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    const preview = await previewUpdate(root, [], {
      publishedVersions: async name => Object.keys(REGISTRY[name] ?? {}),
      packageDependencies: async (name, version) => REGISTRY[name]?.[version],
    });
    expect(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).toBe(before);
    expect(preview.overrides.changes.map(change => `${change.key}: ${change.from} → ${change.to}`)).toEqual([
      'zhin.js: 1.6.0 → 1.7.0', '@zhin.js/core: 1.11.0 → 1.12.0', '@zhin.js/command: 1.4.0 → 1.4.1', '@zhin.js/kernel: ~1.3.0 → ~1.4.0',
    ]);
    const lines = renderUpdatePreview(preview, false);
    const at = (text: string) => lines.findIndex(line => line.includes(text));
    expect(at('  Zhin 包：')).toBeGreaterThan(0);
    expect(at('  其他依赖：')).toBeGreaterThan(at('    zhin.js'));
    expect(at('    @types/node')).toBeGreaterThan(at('  其他依赖：'));
    expect(at('pnpm overrides（Zhin 包的版本锁')).toBeGreaterThan(at('    @types/node'));
    expect(lines).toContain('  package.json 的 pnpm.overrides "@zhin.js/core": 1.11.0 → 1.12.0');
    expect(lines.some(line => /^ {4}@types\/node +22\.0\.0 → 22\.5\.0（\^22\.0\.0）$/u.test(line))).toBe(true);
    // Non-Zhin overrides are not part of the sync.
    expect(lines.some(line => line.includes('left-pad'))).toBe(false);
  });
});
