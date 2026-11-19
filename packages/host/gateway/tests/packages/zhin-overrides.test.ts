/**
 * #1250 update-overrides-not-synced: `zhin update` releases the pnpm overrides that pin Zhin
 * packages before the package manager runs and pins them to the upgraded versions afterwards.
 */
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  classifyZhinOverride,
  installedOverrideTarget,
  pinZhinOverrides,
  readZhinOverrides,
  releaseZhinOverrides,
} from '../../src/plugin-management/zhin-overrides.js';
import { GatewayPackageService, type GatewayPackageManager, type PackageWorkflowPort } from '../../src/packages/index.js';

let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-overrides-'))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function put(file: string, content: unknown): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), typeof content === 'string' ? content : JSON.stringify(content));
}

/** A pnpm-store copy `name@version` with exact dependencies, linked as `node_modules/<name>` when `top`. */
async function stored(name: string, version: string, dependencies: Record<string, string> = {}, top = false): Promise<string> {
  const dir = join(root, 'node_modules/.pnpm', `${name.replace('/', '+')}@${version}`, 'node_modules', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version, dependencies }));
  if (top) {
    await mkdir(dirname(join(root, 'node_modules', name)), { recursive: true });
    await symlink(dir, join(root, 'node_modules', name), 'dir');
  }
  return dir;
}

async function linkDependency(from: string, name: string, target: string): Promise<void> {
  const at = join(from, '..', ...(from.includes('/node_modules/@') ? ['..'] : []), name);
  await mkdir(dirname(at), { recursive: true });
  await symlink(target, at, 'dir');
}

describe('classifyZhinOverride', () => {
  it.each([
    ['zhin.js', '1.6.0', { kind: 'sync', name: 'zhin.js', prefix: '' }],
    ['@zhin.js/core', '^1.11.0', { kind: 'sync', name: '@zhin.js/core', prefix: '^' }],
    ['@zhin.js/core', '~1.11.0', { kind: 'sync', name: '@zhin.js/core', prefix: '~' }],
    ['zhin.js>@zhin.js/core', '1.11.0', { kind: 'sync', name: '@zhin.js/core', parent: 'zhin.js', prefix: '' }],
    ['@zhin.js/plugin-foo>zhin.js', '=1.6.0', { kind: 'sync', name: 'zhin.js', parent: '@zhin.js/plugin-foo', prefix: '' }],
  ])('syncs %s: %s', (key, value, expected) => {
    expect(classifyZhinOverride(key, value)).toEqual(expected);
  });

  it.each([
    ['@types/node', '22.0.0'],
    ['zhin.js>@types/node', '22.0.0'],
    ['zhin.js', 'link:../zhin'],
    ['zhin.js', 'file:./zhin.tgz'],
    ['zhin.js', '$zhin.js'],
    ['@zhin.js/core', 'workspace:*'],
    ['@zhin.js/core', 'npm:@other/core@1.0.0'],
    ['@zhin.js/core', '-'],
  ])('leaves %s: %s alone', (key, value) => {
    expect(classifyZhinOverride(key, value)).toEqual({ kind: 'ignore' });
  });

  it.each([
    ['@zhin.js/core@<1.12', '1.11.0', '键带版本选择器'],
    ['zhin.js@1>@zhin.js/core', '1.11.0', '父包带版本选择器'],
    ['a>zhin.js>@zhin.js/core', '1.11.0', '多级 > 选择器'],
    ['@zhin.js/core', '>=1.11 <1.12', '版本范围'],
    ['@zhin.js/core', { '@zhin.js/kernel': '1.3.0' }, '嵌套对象写法'],
  ])('asks to edit %s by hand', (key, value, reason) => {
    const classified = classifyZhinOverride(key, value);
    expect(classified.kind).toBe('manual');
    expect(classified.kind === 'manual' && classified.reason).toContain(reason);
  });
});

describe('release and pin', () => {
  beforeEach(async () => {
    // zhin.js 1.7.0 is installed; its release requires core 1.12.0, core requires kernel 1.4.0.
    const kernel = await stored('@zhin.js/kernel', '1.4.0');
    const core = await stored('@zhin.js/core', '1.12.0', { '@zhin.js/kernel': '1.4.0' });
    await linkDependency(core, '@zhin.js/kernel', kernel);
    const zhin = await stored('zhin.js', '1.7.0', { '@zhin.js/core': '1.12.0' }, true);
    await linkDependency(zhin, '@zhin.js/core', core);
  });

  it('removes only the syncable Zhin entries, then pins them in their original order and style', async () => {
    const manifest = '{\n    "name": "bot",\n    "pnpm": {\n        "overrides": {\n            "left-pad": "1.3.0",\n            "zhin.js": "1.6.0",\n            "@zhin.js/kernel": "~1.3.0",\n            "zhin.js>@zhin.js/core": "^1.11.0",\n            "@zhin.js/core@<1": "1.0.0"\n        }\n    }\n}\n';
    await put('package.json', manifest);
    const plan = readZhinOverrides(root);
    expect(plan.entries.map(entry => [entry.key, entry.line, entry.class.kind])).toEqual([
      ['zhin.js', 6, 'sync'], ['@zhin.js/kernel', 7, 'sync'], ['zhin.js>@zhin.js/core', 8, 'sync'], ['@zhin.js/core@<1', 9, 'manual'],
    ]);
    await releaseZhinOverrides(root, plan);
    expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).pnpm.overrides).toEqual({ 'left-pad': '1.3.0', '@zhin.js/core@<1': '1.0.0' });
    const result = await pinZhinOverrides(root, plan);
    expect(result.changes).toEqual([
      { file: 'package.json', key: 'zhin.js', from: '1.6.0', to: '1.7.0' },
      { file: 'package.json', key: '@zhin.js/kernel', from: '~1.3.0', to: '~1.4.0' },
      { file: 'package.json', key: 'zhin.js>@zhin.js/core', from: '^1.11.0', to: '^1.12.0' },
    ]);
    expect(result.manual).toHaveLength(1);
    expect(result.manual[0]).toContain('请手动修改 package.json:9');
    const text = await readFile(join(root, 'package.json'), 'utf8');
    // Indentation and key order survive.
    expect(text).toBe(manifest.replace('"1.6.0"', '"1.7.0"').replace('"~1.3.0"', '"~1.4.0"').replace('"^1.11.0"', '"^1.12.0"'));
  });

  it('edits pnpm-workspace.yaml in place, keeping comments and other settings', async () => {
    await put('package.json', { name: 'bot' });
    const yaml = "packages:\n  - plugins/*\n# version locks\noverrides:\n  '@types/node': 22.0.0\n  zhin.js: 1.6.0 # keep one copy\n  '@zhin.js/core': 1.11.0\nallowBuilds:\n  esbuild: true\n";
    await put('pnpm-workspace.yaml', yaml);
    const plan = readZhinOverrides(root);
    expect(plan.entries.map(entry => [entry.file, entry.key, entry.line])).toEqual([
      ['pnpm-workspace.yaml', 'zhin.js', 6], ['pnpm-workspace.yaml', '@zhin.js/core', 7],
    ]);
    const release = await releaseZhinOverrides(root, plan);
    expect(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')).not.toContain('zhin.js:');
    await pinZhinOverrides(root, plan, { release });
    const after = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(after).toContain('# version locks');
    expect(after).toContain("'@types/node': 22.0.0");
    expect(after).toContain('allowBuilds:\n  esbuild: true');
    expect(after.indexOf('@types/node')).toBeLessThan(after.indexOf('zhin.js: 1.7.0'));
    expect(after.indexOf('zhin.js: 1.7.0')).toBeLessThan(after.indexOf('@zhin.js/core'));
    expect(after).toMatch(/['"]@zhin\.js\/core['"]: 1\.12\.0/u);
    expect(after).toBe(yaml.replace('zhin.js: 1.6.0', 'zhin.js: 1.7.0').replace("'@zhin.js/core': 1.11.0", "'@zhin.js/core': 1.12.0"));
  });

  it('changes nothing in pnpm-workspace.yaml but the versions (comments, quotes, flow sequences, layout)', async () => {
    await put('package.json', { name: 'bot' });
    const yaml = [
      '# workspace',
      'packages:',
      '- plugins/*',
      '-   "examples/*"',
      'onlyBuiltDependencies: [esbuild,   \'sharp\']',
      '',
      'overrides:   # version locks',
      '    # the main lock',
      '    "zhin.js": \'1.6.0\'    # keep one copy',
      '    \'@types/node\': "22.0.0"',
      '',
      '    # kernel follows core',
      '    \'@zhin.js/kernel\': ~1.3.0',
      '    "zhin.js>@zhin.js/core": "^1.11.0" # aligned',
      '    left-pad: 1.3.0',
      'allowBuilds: { esbuild: true }',
      '',
    ].join('\n');
    await put('pnpm-workspace.yaml', yaml);
    const plan = readZhinOverrides(root);
    expect(plan.entries.map(entry => [entry.key, entry.line])).toEqual([['zhin.js', 9], ['@zhin.js/kernel', 13], ['zhin.js>@zhin.js/core', 14]]);
    const release = await releaseZhinOverrides(root, plan);
    // Released: only the Zhin entries (with the blank and comment lines directly above them) are gone.
    expect(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe([
      '# workspace', 'packages:', '- plugins/*', '-   "examples/*"', 'onlyBuiltDependencies: [esbuild,   \'sharp\']', '',
      'overrides:   # version locks', '    \'@types/node\': "22.0.0"', '    left-pad: 1.3.0', 'allowBuilds: { esbuild: true }', '',
    ].join('\n'));
    const result = await pinZhinOverrides(root, plan, { release });
    expect(result.changes.map(change => change.to)).toEqual(['1.7.0', '~1.4.0', '^1.12.0']);
    expect(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(yaml
      .replace("'1.6.0'", "'1.7.0'").replace('~1.3.0', '~1.4.0').replace('"^1.11.0"', '"^1.12.0"'));
  });

  it('puts every entry back when the release emptied the overrides map', async () => {
    await put('package.json', { name: 'bot' });
    const yaml = "overrides:\n  # only Zhin\n  zhin.js: '1.6.0'\n  '@zhin.js/core': 1.11.0 # same release\npackages:\n  - plugins/*\n";
    await put('pnpm-workspace.yaml', yaml);
    const plan = readZhinOverrides(root);
    const release = await releaseZhinOverrides(root, plan);
    expect(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe('overrides:\npackages:\n  - plugins/*\n');
    await pinZhinOverrides(root, plan, { release });
    expect(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(yaml.replace("'1.6.0'", "'1.7.0'").replace('1.11.0', '1.12.0'));
  });

  it('points manual hints at the entry inside pnpm.overrides, not at npm overrides or other keys', async () => {
    const manifest = [
      '{',
      '  "name": "bot",',
      '  "overrides": {',
      '    "zhin.js": ">=1 <2"',
      '  },',
      '  "scripts": { "overrides": "echo \\"zhin.js\\": x" },',
      '  "pnpm": {',
      '    "peerDependencyRules": { "allowedVersions": { "zhin.js": "1" } },',
      '    "overrides": {',
      '      "left": "1.0.0",',
      '      "zhin.js": ">=1 <2"',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n');
    await put('package.json', manifest);
    const plan = readZhinOverrides(root);
    expect(plan.entries.map(entry => [entry.key, entry.line])).toEqual([['zhin.js', 11]]);
    expect(pinZhinOverrides(root, plan).then(result => result.manual)).resolves.toEqual([expect.stringContaining('请手动修改 package.json:11')]);
  });

  it('leaves a block-scalar value for a manual edit and cuts nothing else (#1250 第 56 批)', async () => {
    await put('package.json', { name: 'bot' });
    const yaml = "overrides:\n  zhin.js: >-\n    1.6.0\n  '@zhin.js/core': 1.11.0\n  left-pad: |\n    1.3.0\n  '@zhin.js/kernel': ~1.3.0\npackages:\n  - plugins/*\n";
    await put('pnpm-workspace.yaml', yaml);
    const plan = readZhinOverrides(root);
    expect(plan.entries.map(entry => [entry.key, entry.line, entry.class.kind])).toEqual([
      ['zhin.js', 2, 'manual'], ['@zhin.js/core', 4, 'sync'], ['@zhin.js/kernel', 7, 'sync'],
    ]);
    const release = await releaseZhinOverrides(root, plan);
    // Only the two one-line entries are cut; the block scalars and the entries after them stay whole.
    expect(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8'))
      .toBe("overrides:\n  zhin.js: >-\n    1.6.0\n  left-pad: |\n    1.3.0\npackages:\n  - plugins/*\n");
    const result = await pinZhinOverrides(root, plan, { release });
    expect(result.manual).toEqual([expect.stringContaining('请手动修改 pnpm-workspace.yaml:2')]);
    expect(result.manual[0]).toContain('块标量');
    expect(result.changes.map(change => [change.key, change.to])).toEqual([['@zhin.js/core', '1.12.0'], ['@zhin.js/kernel', '~1.4.0']]);
    expect(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8'))
      .toBe(yaml.replace('1.11.0', '1.12.0').replace('~1.3.0', '~1.4.0'));
  });

  it('leaves an anchored value that an alias uses, and the alias, for a manual edit (#1250 第 56 批)', async () => {
    await put('package.json', { name: 'bot' });
    const yaml = "overrides:\n  '@zhin.js/core': &core 1.11.0\n  'zhin.js>@zhin.js/core': *core\n  '@zhin.js/kernel': &k 1.3.0\npackages:\n  - plugins/*\n";
    await put('pnpm-workspace.yaml', yaml);
    const plan = readZhinOverrides(root);
    expect(plan.entries.map(entry => [entry.key, entry.line, entry.class.kind])).toEqual([
      ['@zhin.js/core', 2, 'manual'], ['zhin.js>@zhin.js/core', 3, 'manual'], ['@zhin.js/kernel', 4, 'sync'],
    ]);
    const release = await releaseZhinOverrides(root, plan);
    // The anchor stays, so the alias still resolves; an anchor nobody uses is released as usual.
    const released = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(released).toBe("overrides:\n  '@zhin.js/core': &core 1.11.0\n  'zhin.js>@zhin.js/core': *core\npackages:\n  - plugins/*\n");
    const result = await pinZhinOverrides(root, plan, { release });
    expect(result.manual).toEqual([
      expect.stringContaining('请手动修改 pnpm-workspace.yaml:2'),
      expect.stringContaining('请手动修改 pnpm-workspace.yaml:3'),
    ]);
    expect(result.manual[0]).toContain('锚点（&core）且被别处引用');
    expect(result.manual[1]).toContain('别名（*core）');
    expect(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(yaml.replace('&k 1.3.0', '&k 1.4.0'));
  });

  it('keeps the old value and says so when no installed version is found', async () => {
    await put('package.json', { name: 'bot', pnpm: { overrides: { '@zhin.js/agent': '1.0.0' } } });
    const plan = readZhinOverrides(root);
    expect(installedOverrideTarget(root, plan.entries[0]!)).toBeUndefined();
    await releaseZhinOverrides(root, plan);
    const result = await pinZhinOverrides(root, plan);
    expect(result.changes).toEqual([]);
    expect(result.manual[0]).toContain('"@zhin.js/agent": "1.0.0"——无法确定升级后的版本');
    expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).pnpm.overrides).toEqual({ '@zhin.js/agent': '1.0.0' });
  });
});

describe('GatewayPackageService.update with Zhin overrides', () => {
  const LOCK = 'lockfileVersion: 9.0\n';

  function recordingManager(calls: string[], seen: unknown[]): GatewayPackageManager {
    return async (args, projectRoot) => {
      calls.push(args.join(' '));
      seen.push(JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')).pnpm?.overrides);
    };
  }

  beforeEach(async () => {
    await put('package.json', { name: 'bot', zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false }, dependencies: { 'zhin.js': '^1.6.0', '@types/node': '^22.0.0' }, pnpm: { overrides: { 'zhin.js': '1.6.0', '@types/node': '22.0.0' } } });
    await put('plugin.js', 'export default {};');
    await put('zhin.config.json', { configVersion: 2, plugins: {} });
    await put('pnpm-lock.yaml', LOCK);
    await stored('zhin.js', '1.7.0', {}, true);
  });

  it('runs the update without the Zhin locks, pins them again and installs once', async () => {
    const calls: string[] = [];
    const seen: unknown[] = [];
    const service = new GatewayPackageService({ projectRoot: root, packageManager: recordingManager(calls, seen), hasOwner: () => true });
    const chunks: string[] = [];
    const result = await service.update('all', { principal: 'local', onEvent: event => { if (event.type === 'output') chunks.push(event.chunk); } });
    expect(result).toMatchObject({ ok: true });
    expect(calls).toEqual(['update', 'install --no-frozen-lockfile']);
    expect(seen).toEqual([{ '@types/node': '22.0.0' }, { 'zhin.js': '1.7.0', '@types/node': '22.0.0' }]);
    expect(chunks.join('')).toContain('同步 overrides：package.json 的 pnpm.overrides "zhin.js": 1.6.0 → 1.7.0');
  });

  it('does not touch the Zhin locks when the update names only other packages', async () => {
    const calls: string[] = [];
    const seen: unknown[] = [];
    const service = new GatewayPackageService({ projectRoot: root, packageManager: recordingManager(calls, seen), hasOwner: () => true });
    expect(await service.update(['@types/node'], { principal: 'local' })).toMatchObject({ ok: true });
    expect(calls).toEqual(['update @types/node']);
    expect(seen).toEqual([{ 'zhin.js': '1.6.0', '@types/node': '22.0.0' }]);
  });

  it('restores the locks when the package manager fails', async () => {
    const before = await readFile(join(root, 'package.json'), 'utf8');
    const service = new GatewayPackageService({
      projectRoot: root, hasOwner: () => true,
      packageManager: async (args) => { if (args[0] === 'update') throw new Error('registry down'); },
    });
    expect(await service.update('all', { principal: 'local' })).toMatchObject({ ok: false, status: 'rolledBack', failedPhase: 'package-manager' });
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(before);
  });

  it('succeeds with CI=true, where pnpm freezes the lockfile unless told otherwise', async () => {
    vi.stubEnv('CI', 'true');
    try {
      const calls: string[] = [];
      const service = new GatewayPackageService({
        projectRoot: root, hasOwner: () => true,
        // pnpm in CI: a plain install refuses the lockfile the re-pinned overrides no longer match.
        packageManager: async (args) => {
          calls.push(args.join(' '));
          if (process.env.CI && args[0] === 'install' && !args.includes('--no-frozen-lockfile')) {
            throw new Error('ERR_PNPM_LOCKFILE_CONFIG_MISMATCH Cannot proceed with the frozen installation');
          }
        },
      });
      expect(await service.update('all', { principal: 'local' })).toMatchObject({ ok: true, status: 'succeeded' });
      expect(calls).toEqual(['update', 'install --no-frozen-lockfile']);
      expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).pnpm.overrides).toEqual({ 'zhin.js': '1.7.0', '@types/node': '22.0.0' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('leaves pnpm.overrides alone in a project that does not install with pnpm', async () => {
    await rm(join(root, 'pnpm-lock.yaml'));
    await put('package-lock.json', '{}');
    const calls: string[] = [];
    const seen: unknown[] = [];
    const service = new GatewayPackageService({ projectRoot: root, packageManager: recordingManager(calls, seen), hasOwner: () => true });
    const chunks: string[] = [];
    expect(await service.update('all', { principal: 'local', onEvent: event => { if (event.type === 'output') chunks.push(event.chunk); } })).toMatchObject({ ok: true });
    expect(calls).toEqual(['update']);
    expect(seen).toEqual([{ 'zhin.js': '1.6.0', '@types/node': '22.0.0' }]);
    expect(chunks.join('')).not.toContain('overrides');
  });
});

describe('GatewayPackageService.update of one Zhin package', () => {
  const LOCK = 'lockfileVersion: 9.0\n';
  let core: string;

  /** Installs `@zhin.js/core@version` at the project root, as the package manager would. */
  async function installRootCore(version: string): Promise<void> {
    const dir = await stored('@zhin.js/core', version);
    await unlink(join(root, 'node_modules/@zhin.js/core')).catch(() => undefined);
    await mkdir(join(root, 'node_modules/@zhin.js'), { recursive: true });
    await symlink(dir, join(root, 'node_modules/@zhin.js/core'), 'dir');
  }

  function workflow(calls: string[]): PackageWorkflowPort {
    return {
      inspect: async () => ({ declared: true }),
      install: async () => undefined,
      uninstall: async () => undefined,
      update: async (name, version) => { calls.push(`workflow update ${name}@${version}`); await installRootCore(version); },
    };
  }

  beforeEach(async () => {
    await put('package.json', { name: 'bot', dependencies: { 'zhin.js': '^1.7.0', '@zhin.js/core': '^1.12.0' }, pnpm: { overrides: { '@zhin.js/core': '1.12.0' } } });
    await put('zhin.config.json', { configVersion: 2, plugins: {} });
    await put('pnpm-lock.yaml', LOCK);
    // zhin.js 1.7.0's release requires core 1.12.0 exactly.
    core = await stored('@zhin.js/core', '1.12.0');
    const zhin = await stored('zhin.js', '1.7.0', { '@zhin.js/core': '1.12.0' }, true);
    await linkDependency(zhin, '@zhin.js/core', core);
    await installRootCore('1.12.0');
  });

  it('fails, rolls back and says to upgrade zhin.js when the override would pin the request back', async () => {
    const before = await readFile(join(root, 'package.json'), 'utf8');
    const calls: string[] = [];
    const service = new GatewayPackageService({
      projectRoot: root, hasOwner: () => true, workflow: workflow(calls),
      packageManager: async (args) => { calls.push(args.join(' ')); },
    });
    const result = await service.update(['@zhin.js/core@1.13.0'], { principal: 'local' });
    expect(result).toMatchObject({ ok: false, status: 'rolledBack', failedPhase: 'package-manager' });
    expect(result.error).toContain('@zhin.js/core@1.13.0 无法单独升级');
    expect(result.error).toContain('会把它钉回 1.12.0');
    expect(result.error).toContain('请改为升级 zhin.js');
    expect(result.error).toContain('手动把 package.json:1 的 "@zhin.js/core" 改成 "1.13.0"');
    // Nothing pinned, nothing reinstalled with the overrides; the files are back.
    expect(calls).toEqual(['workflow update @zhin.js/core@1.13.0', 'install --frozen-lockfile']);
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(before);
  });

  it('fails and rolls back when the reinstall does not end on the requested version', async () => {
    const before = await readFile(join(root, 'package.json'), 'utf8');
    await put('package.json', { name: 'bot', dependencies: { 'zhin.js': '^1.7.0', '@zhin.js/core': '^1.12.0' }, pnpm: { overrides: { '@zhin.js/core': '^1.11.0' } } });
    const pinned = await readFile(join(root, 'package.json'), 'utf8');
    const calls: string[] = [];
    const service = new GatewayPackageService({
      projectRoot: root, hasOwner: () => true, workflow: workflow(calls),
      // The reinstall with the re-pinned `^1.12.0` resolves another 1.12.x.
      packageManager: async (args) => { calls.push(args.join(' ')); if (args.includes('--no-frozen-lockfile')) await installRootCore('1.12.5'); },
    });
    const result = await service.update(['@zhin.js/core@1.12.0'], { principal: 'local' });
    expect(result).toMatchObject({ ok: false, status: 'rolledBack' });
    expect(result.error).toContain('@zhin.js/core 请求的是 1.12.0，同步 overrides 并重装后实际安装的是 1.12.5');
    expect(calls).toEqual(['workflow update @zhin.js/core@1.12.0', 'install --no-frozen-lockfile', 'install --frozen-lockfile']);
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(pinned);
    expect(pinned).not.toBe(before);
  });

  it('pins the override to the requested version when zhin.js agrees', async () => {
    await put('package.json', { name: 'bot', dependencies: { 'zhin.js': '^1.7.0', '@zhin.js/core': '^1.11.0' }, pnpm: { overrides: { '@zhin.js/core': '1.11.0' } } });
    const calls: string[] = [];
    const service = new GatewayPackageService({
      projectRoot: root, hasOwner: () => true, workflow: workflow(calls),
      packageManager: async (args) => { calls.push(args.join(' ')); },
    });
    expect(await service.update(['@zhin.js/core@1.12.0'], { principal: 'local' })).toMatchObject({ ok: true });
    expect(calls).toEqual(['workflow update @zhin.js/core@1.12.0', 'install --no-frozen-lockfile']);
    expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).pnpm.overrides).toEqual({ '@zhin.js/core': '1.12.0' });
  });
});
