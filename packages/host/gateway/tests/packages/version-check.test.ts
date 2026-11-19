import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GATEWAY_RPC, GATEWAY_RPC_PERMISSIONS, type GatewayInstalledPackage } from '@zhin.js/console-protocol';
import {
  classifyPackageVersion,
  createGatewayRpcDispatcher,
  GatewayPackageService,
  GatewayVersionChecker,
  isVersionCheckedPackage,
  parseNpmViewVersions,
  type RegistryFetcher,
  type RegistryPackageInfo,
} from '../../src/packages/index.js';
import { noPermissionUser, testUser } from '../utils/console-users.js';

const installed = (name: string, range: string, version: string | null, kind?: GatewayInstalledPackage['kind']): GatewayInstalledPackage => ({
  name, range, dependencyType: 'dependencies', installedVersion: version, ...(kind ? { kind } : {}),
});

const REGISTRY: Readonly<Record<string, RegistryPackageInfo>> = {
  'zhin.js': { latest: '2.0.0', versions: ['1.5.0', '1.6.0', '1.7.2', '2.0.0'] },
  '@zhin.js/gateway': { latest: '1.7.0', versions: ['1.6.1', '1.7.0'] },
  '@zhin.js/console-ui': { latest: '1.2.0', versions: ['1.2.0'] },
  '@zhin.js/adapter-sandbox': { latest: '1.0.3', versions: ['1.0.0', '1.0.3'] },
};

function fakeFetcher(registry: Readonly<Record<string, RegistryPackageInfo | null | undefined>> = REGISTRY) {
  const calls: string[] = [];
  const fetcher: RegistryFetcher = async (name, options) => {
    calls.push(name);
    expect(options.cwd).toBe('/project');
    return registry[name];
  };
  return { calls, fetcher };
}

const INVENTORY = [
  installed('zhin.js', '^1.6.0', '1.6.0'),
  installed('@zhin.js/console-ui', '^1.2.0', '1.2.0', 'library'),
  installed('@zhin.js/adapter-sandbox', '^1.0.0', '1.0.0', 'plugin'),
  installed('@zhin.js/tool', '^1.0.0', '1.0.0', 'feature'),
  installed('zod', '^4.0.0', '4.1.0', 'library'),
];

describe('gateway version check (zhinjs/console#64)', () => {
  it('covers zhin.js, the gateway, Console packages and installed @zhin.js plugins only', () => {
    expect(isVersionCheckedPackage({ name: 'zhin.js' })).toBe(true);
    expect(isVersionCheckedPackage({ name: '@zhin.js/gateway' })).toBe(true);
    expect(isVersionCheckedPackage({ name: '@zhin.js/console-client' })).toBe(true);
    expect(isVersionCheckedPackage({ name: '@zhin.js/adapter-qq', kind: 'plugin' })).toBe(true);
    expect(isVersionCheckedPackage({ name: '@zhin.js/tool', kind: 'feature' })).toBe(false);
    expect(isVersionCheckedPackage({ name: 'zhin-plugin-x', kind: 'plugin' })).toBe(false);
    expect(isVersionCheckedPackage({ name: 'zod', kind: 'library' })).toBe(false);
  });

  it('classifies in-range updates and upgrades that need zhin migrate', () => {
    expect(classifyPackageVersion('zhin.js', '^1.6.0', '1.6.0', REGISTRY['zhin.js'])).toEqual({
      name: 'zhin.js', range: '^1.6.0', installed: '1.6.0', latest: '2.0.0', wanted: '1.7.2',
      latestInRange: false, updateAvailable: true, needsMigrate: true,
    });
    expect(classifyPackageVersion('a', '^1.0.0', '1.0.0', { latest: '1.0.3', versions: ['1.0.0', '1.0.3'] }))
      .toMatchObject({ latest: '1.0.3', wanted: '1.0.3', latestInRange: true, updateAvailable: true, needsMigrate: false });
    expect(classifyPackageVersion('a', '^1.0.0', '1.0.3', { latest: '1.0.3', versions: ['1.0.0', '1.0.3'] }))
      .toMatchObject({ latestInRange: true, updateAvailable: false, needsMigrate: false });
    // An exact pin: any newer release changes the declared range.
    expect(classifyPackageVersion('a', '1.0.0', '1.0.0', { latest: '1.0.3', versions: ['1.0.0', '1.0.3'] }))
      .toMatchObject({ wanted: '1.0.0', latestInRange: false, updateAvailable: false, needsMigrate: true });
    // Not a direct dependency (the running gateway): a newer release goes through zhin migrate.
    expect(classifyPackageVersion('@zhin.js/gateway', null, '1.6.1', REGISTRY['@zhin.js/gateway']))
      .toMatchObject({ range: null, wanted: null, latestInRange: false, updateAvailable: false, needsMigrate: true });
    // Workspace / link ranges are never classified.
    expect(classifyPackageVersion('a', 'workspace:*', '1.0.0', { latest: '2.0.0', versions: ['2.0.0'] }))
      .toMatchObject({ latest: '2.0.0', latestInRange: false, updateAvailable: false, needsMigrate: false });
    // Registry unknown → latest null, nothing flagged.
    expect(classifyPackageVersion('a', '^1.0.0', '1.0.0', undefined))
      .toEqual({ name: 'a', range: '^1.0.0', installed: '1.0.0', latest: null, wanted: null, latestInRange: false, updateAvailable: false, needsMigrate: false });
  });

  it('reports the selected packages plus the running gateway, and caches registry answers for about 6 h', async () => {
    let now = 1_000;
    const { calls, fetcher } = fakeFetcher();
    const checker = new GatewayVersionChecker({ projectRoot: '/project', inventory: async () => INVENTORY, gatewayVersion: () => '1.6.1', fetcher, now: () => now });
    const report = await checker.check();
    expect(report).toMatchObject({ gateway: '1.6.1', checkedAt: 1_000, registryReachable: true });
    expect(report.packages.map(row => row.name)).toEqual(['@zhin.js/console-ui', 'zhin.js', '@zhin.js/adapter-sandbox', '@zhin.js/gateway']);
    expect(report.truncated).toBe(false);
    expect(report.packages.find(row => row.name === '@zhin.js/gateway')).toMatchObject({ range: null, installed: '1.6.1', latest: '1.7.0', needsMigrate: true });
    expect(report.packages.find(row => row.name === '@zhin.js/adapter-sandbox')).toMatchObject({ latestInRange: true, updateAvailable: true, needsMigrate: false });
    expect(calls.sort()).toEqual(['@zhin.js/adapter-sandbox', '@zhin.js/console-ui', '@zhin.js/gateway', 'zhin.js']);

    now += 5 * 60 * 60 * 1000;
    expect((await checker.check()).checkedAt).toBe(1_000);
    expect(calls).toHaveLength(4);
    now += 2 * 60 * 60 * 1000;
    await checker.check();
    expect(calls).toHaveLength(8);
  });

  it('shares one lookup between concurrent checks', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const calls: string[] = [];
    const checker = new GatewayVersionChecker({
      projectRoot: '/project', inventory: async () => [installed('zhin.js', '^1.0.0', '1.0.0')],
      fetcher: async name => { calls.push(name); await gate; return REGISTRY[name]; },
    });
    const both = Promise.all([checker.check(), checker.check()]);
    await new Promise(resolve => setTimeout(resolve, 0));
    release();
    const [a, b] = await both;
    expect(calls).toEqual(['zhin.js']);
    expect(a.packages[0]!.latest).toBe('2.0.0');
    expect(b.packages[0]!.latest).toBe('2.0.0');
  });

  it('yields latest: null when the registry times out, without querying every package', async () => {
    const calls: string[] = [];
    let now = 0;
    const checker = new GatewayVersionChecker({
      projectRoot: '/project', inventory: async () => INVENTORY, gatewayVersion: () => '1.6.1', timeoutMs: 20, now: () => now,
      fetcher: name => { calls.push(name); return new Promise(() => undefined); },
    });
    const report = await checker.check();
    expect(report.registryReachable).toBe(false);
    expect(report.packages.every(row => row.latest === null && !row.needsMigrate && !row.updateAvailable)).toBe(true);
    expect(calls).toHaveLength(1);
    // Unreachable: further checks within the failure TTL do not query again.
    now += 60_000;
    expect((await checker.check()).registryReachable).toBe(false);
    expect(calls).toHaveLength(1);
    now += 10 * 60 * 1000;
    await checker.check();
    expect(calls).toHaveLength(2);
  });

  it('treats a throwing fetcher (offline) as unknown, never as an error', async () => {
    const checker = new GatewayVersionChecker({
      projectRoot: '/project', inventory: async () => INVENTORY,
      fetcher: async () => { throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org'); },
    });
    await expect(checker.check()).resolves.toMatchObject({ gateway: null, registryReachable: false });
  });

  it('keeps answers for packages the registry does know when one is not published there', async () => {
    // null: the registry answered (E404); unlike undefined it does not mean "unreachable".
    const { fetcher } = fakeFetcher({ ...REGISTRY, 'zhin.js': null });
    const checker = new GatewayVersionChecker({ projectRoot: '/project', inventory: async () => INVENTORY, fetcher });
    const report = await checker.check();
    expect(report.registryReachable).toBe(true);
    expect(report.packages.find(row => row.name === 'zhin.js')!.latest).toBeNull();
    expect(report.packages.find(row => row.name === '@zhin.js/console-ui')!.latest).toBe('1.2.0');
  });

  it('keeps zhin.js when a name sort would drop it past the package cap', async () => {
    const plugins = Array.from({ length: 70 }, (_, index) => installed(
      `@zhin.js/adapter-${String(index).padStart(2, '0')}`, '^1.0.0', '1.0.0', 'plugin',
    ));
    const { fetcher } = fakeFetcher();
    const checker = new GatewayVersionChecker({
      projectRoot: '/project',
      inventory: async () => [...plugins, installed('zhin.js', '^1.6.0', '1.6.0'), installed('@zhin.js/console-ui', '^1.2.0', '1.2.0', 'library')],
      fetcher,
    });
    const report = await checker.check();
    expect(report.truncated).toBe(true);
    expect(report.packages.map(row => row.name)).toContain('zhin.js');
    expect(report.packages.map(row => row.name)).toContain('@zhin.js/console-ui');
    expect(report.packages.some(row => row.name === '@zhin.js/adapter-69')).toBe(false);
    expect(report.packages).toHaveLength(64);
  });

  it('returns answers already in hand when the overall deadline passes', async () => {
    let now = 0;
    const calls: string[] = [];
    const checker = new GatewayVersionChecker({
      projectRoot: '/project',
      inventory: async () => INVENTORY,
      gatewayVersion: () => '1.6.1',
      timeoutMs: 5_000,
      deadlineMs: 1_000,
      concurrency: 1,
      now: () => now,
      fetcher: async name => {
        calls.push(name);
        now += 5_000;
        return REGISTRY[name];
      },
    });
    const started = Date.now();
    const report = await checker.check();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(calls).toEqual(['@zhin.js/console-ui']);
    expect(report.registryReachable).toBe(true);
    expect(report.packages.find(row => row.name === '@zhin.js/console-ui')!.latest).toBe('1.2.0');
    expect(report.packages.find(row => row.name === 'zhin.js')!.latest).toBeNull();
    expect(report.truncated).toBe(false);
  });

  it('parses npm view output', () => {
    expect(parseNpmViewVersions(JSON.stringify({ 'dist-tags': { latest: '1.2.0', next: '2.0.0-beta.1' }, versions: ['1.1.0', '1.2.0'] })))
      .toEqual({ latest: '1.2.0', versions: ['1.1.0', '1.2.0'] });
    expect(parseNpmViewVersions(JSON.stringify({ 'dist-tags': { latest: '1.0.0' }, versions: '1.0.0' }))).toEqual({ latest: '1.0.0', versions: ['1.0.0'] });
    expect(parseNpmViewVersions('npm ERR! 404')).toBeUndefined();
    expect(parseNpmViewVersions('{}')).toBeUndefined();
  });
});

describe('gateway.version.check RPC', () => {
  let root: string;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-gateway-version-')));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bot', version: '1.0.0', dependencies: { 'zhin.js': '^1.6.0', pg: '^8.0.0' } }));
    await mkdir(join(root, 'node_modules/zhin.js'), { recursive: true });
    await writeFile(join(root, 'node_modules/zhin.js/package.json'), JSON.stringify({ name: 'zhin.js', version: '1.6.0' }));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('needs status.view and reads the project inventory', async () => {
    expect(GATEWAY_RPC_PERMISSIONS[GATEWAY_RPC.CHECK]).toBe('status.view');
    const packages = new GatewayPackageService({ projectRoot: root, hasOwner: () => true, packageManager: async () => undefined });
    const fetcher: RegistryFetcher = async name => REGISTRY[name];
    const version = new GatewayVersionChecker({ projectRoot: root, inventory: async () => (await packages.inventory()).packages, gatewayVersion: () => '1.6.1', fetcher });
    const dispatch = createGatewayRpcDispatcher({ packages, version });
    const reply = await dispatch({ type: GATEWAY_RPC.CHECK }, testUser('viewer'));
    expect(reply).toMatchObject({ ok: true, data: { gateway: '1.6.1', registryReachable: true,
      packages: [{ name: 'zhin.js', installed: '1.6.0', latest: '2.0.0', needsMigrate: true }, { name: '@zhin.js/gateway', range: null }] } });
    expect(await dispatch({ type: GATEWAY_RPC.CHECK }, noPermissionUser())).toMatchObject({ ok: false, error: { code: 'forbidden', status: 403 } });
    expect(await dispatch({ type: GATEWAY_RPC.CHECK }, undefined)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await createGatewayRpcDispatcher({})({ type: GATEWAY_RPC.CHECK }, testUser('owner'))).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });
});
