/**
 * Read-only version check of the project's Zhin packages (`gateway.version.check`,
 * zhinjs/console#64). The gateway queries the registry the project's npm configuration points to
 * (`.npmrc`, mirrors included, via `npm view` in the project root), caches answers in memory for
 * about six hours and treats every failure — offline, timeout, unknown package — as "unknown"
 * (`latest: null`), never as an error. It only reports: upgrades that change a declared range or
 * need migrations stay with `zhin migrate` (ADR 0062).
 */
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import type { GatewayInstalledPackage, GatewayVersionPackage, GatewayVersionReport } from '@zhin.js/console-protocol';

/** The `semver` functions the check uses (the package ships no types). */
interface SemverModule {
  valid(version: string): string | null;
  validRange(range: string): string | null;
  satisfies(version: string, range: string): boolean;
  maxSatisfying(versions: readonly string[], range: string): string | null;
  gt(a: string, b: string): boolean;
}

const require = createRequire(import.meta.url);
const semver = require('semver') as SemverModule;

/** What the registry says about one package. */
export interface RegistryPackageInfo {
  /** The `latest` dist-tag; null when the package has none. */
  readonly latest: string | null;
  /** Every published version. */
  readonly versions: readonly string[];
}

export interface RegistryFetchOptions {
  /** Directory whose npm configuration (`.npmrc`) selects the registry: the project root. */
  readonly cwd: string;
  readonly timeoutMs: number;
}

/**
 * Looks one package up: `null` when the registry answered that it does not know the package,
 * `undefined` (never a throw) when the registry could not be reached.
 */
export type RegistryFetcher = (name: string, options: RegistryFetchOptions) => Promise<RegistryPackageInfo | null | undefined>;

/** A settled lookup: the registry's answer (`null`: not published there) or `failed` (unreachable). */
type LookupResult = RegistryPackageInfo | null | 'failed';

/** The project dependencies the check reads (`GatewayPackageService.inventory()`). */
export type VersionInventory = () => Promise<readonly GatewayInstalledPackage[]>;

export interface GatewayVersionCheckerOptions {
  readonly projectRoot: string;
  readonly inventory: VersionInventory;
  /** Version of the running gateway. */
  readonly gatewayVersion?: () => string | null;
  /** Default: `npm view <name> dist-tags versions --json` in the project root. */
  readonly fetcher?: RegistryFetcher;
  /** How long a registry answer is reused. Default 6 h. */
  readonly ttlMs?: number;
  /** How long a failed lookup is remembered before it is retried. Default 10 min. */
  readonly failureTtlMs?: number;
  /** Per-lookup timeout. Default 5 s. */
  readonly timeoutMs?: number;
  /** Parallel lookups. Default 4. */
  readonly concurrency?: number;
  readonly now?: () => number;
}

export const DEFAULT_VERSION_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_VERSION_CHECK_FAILURE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 5_000;
const GATEWAY_PACKAGE = '@zhin.js/gateway';
const MAX_PACKAGES = 64;

interface CacheEntry {
  readonly at: number;
  readonly result: Promise<LookupResult>;
  /** Set once {@link result} settled. */
  settled?: LookupResult;
}

/**
 * Which project dependencies the check covers: `zhin.js`, `@zhin.js/gateway`, the Console packages
 * (`@zhin.js/console-*`) and installed `@zhin.js/*` plugins (`package.json#zhin.type: "plugin"`).
 */
export function isVersionCheckedPackage(pkg: Pick<GatewayInstalledPackage, 'name' | 'kind'>): boolean {
  if (pkg.name === 'zhin.js' || pkg.name === GATEWAY_PACKAGE || pkg.name.startsWith('@zhin.js/console-')) return true;
  return pkg.name.startsWith('@zhin.js/') && pkg.kind === 'plugin';
}

/**
 * Compares one package with the registry. `range` null means "not a direct dependency" (the
 * running gateway): a newer release is then reached through `zhin migrate`. Ranges that are not
 * semver ranges (`workspace:*`, `link:`, `file:`, git) are never classified as updatable.
 */
export function classifyPackageVersion(
  name: string,
  range: string | null,
  installed: string | null,
  info: RegistryPackageInfo | undefined,
): GatewayVersionPackage {
  const current = installed && semver.valid(installed) ? installed : null;
  const latest = info?.latest && semver.valid(info.latest) ? info.latest : null;
  const semverRange = range !== null && semver.validRange(range) !== null ? range : null;
  const versions = info ? info.versions.filter(version => semver.valid(version) !== null) : [];
  const wanted = semverRange && versions.length ? semver.maxSatisfying(versions, semverRange) : null;
  const latestInRange = Boolean(latest && semverRange && semver.satisfies(latest, semverRange));
  const updateAvailable = Boolean(wanted && current && semver.gt(wanted, current));
  const classifiable = range === null || semverRange !== null;
  const needsMigrate = Boolean(classifiable && latest && current && !latestInRange && semver.gt(latest, current));
  return Object.freeze({ name, range, installed: installed ?? null, latest, wanted, latestInRange, updateAvailable, needsMigrate });
}

export class GatewayVersionChecker {
  readonly #options: GatewayVersionCheckerOptions;
  readonly #fetcher: RegistryFetcher;
  readonly #cache = new Map<string, CacheEntry>();
  readonly #now: () => number;
  /** When a probe last found the registry unreachable; lookups pause for the failure TTL afterwards. */
  #unreachableAt: number | undefined;

  constructor(options: GatewayVersionCheckerOptions) {
    this.#options = options;
    this.#fetcher = options.fetcher ?? npmViewRegistryFetcher;
    this.#now = options.now ?? Date.now;
  }

  /** Builds the report; never throws for registry problems (a failed inventory still rejects). */
  async check(): Promise<GatewayVersionReport> {
    const gateway = this.#options.gatewayVersion?.() ?? null;
    const dependencies = (await this.#options.inventory()).filter(isVersionCheckedPackage).slice(0, MAX_PACKAGES);
    const rows: { name: string; range: string | null; installed: string | null }[] = dependencies.map(pkg => ({
      name: pkg.name, range: pkg.range, installed: pkg.installedVersion,
    }));
    // The running gateway is reported even when the project does not declare it (installed globally / via the CLI).
    if (!rows.some(row => row.name === GATEWAY_PACKAGE) && gateway) rows.push({ name: GATEWAY_PACKAGE, range: null, installed: gateway });
    const names = [...new Set(rows.map(row => row.name))];
    const results = await this.#lookupAll(names);
    let checkedAt = 0;
    for (const name of names) checkedAt = Math.max(checkedAt, this.#cache.get(name)?.at ?? 0);
    const packages = rows.map(row => {
      const result = results.get(row.name);
      return classifyPackageVersion(row.name, row.range, row.installed, result && result !== 'failed' ? result : undefined);
    });
    return Object.freeze({
      gateway,
      packages: Object.freeze(packages),
      checkedAt: checkedAt || this.#now(),
      registryReachable: names.length === 0 || [...results.values()].some(result => result !== 'failed'),
    });
  }

  /**
   * Looks names up (cache first). One uncached name is probed first: when the registry is
   * unreachable the others are skipped instead of each waiting for its timeout.
   */
  async #lookupAll(names: readonly string[]): Promise<Map<string, LookupResult>> {
    const result = new Map<string, LookupResult>();
    const pending = names.filter(name => {
      const settled = this.#fresh(name)?.settled;
      if (settled !== undefined) { result.set(name, settled); return false; }
      return true;
    });
    if (!pending.length) return result;
    const failureTtl = this.#options.failureTtlMs ?? DEFAULT_VERSION_CHECK_FAILURE_TTL_MS;
    if (this.#unreachableAt !== undefined && this.#now() - this.#unreachableAt < failureTtl) {
      for (const name of pending) result.set(name, 'failed');
      return result;
    }
    const [probe, ...rest] = pending as [string, ...string[]];
    const probed = await this.#lookup(probe);
    result.set(probe, probed);
    if (probed === 'failed') {
      this.#unreachableAt = this.#now();
      for (const name of rest) result.set(name, 'failed');
      return result;
    }
    this.#unreachableAt = undefined;
    const queue = [...rest];
    const workers = Array.from({ length: Math.max(1, Math.min(this.#options.concurrency ?? 4, queue.length)) }, async () => {
      for (let name = queue.shift(); name !== undefined; name = queue.shift()) result.set(name, await this.#lookup(name));
    });
    await Promise.all(workers);
    return result;
  }

  #fresh(name: string): CacheEntry | undefined {
    const entry = this.#cache.get(name);
    if (!entry) return undefined;
    // An unsettled lookup is shared by concurrent checks.
    if (entry.settled === undefined) return entry;
    const ttl = entry.settled === 'failed'
      ? this.#options.failureTtlMs ?? DEFAULT_VERSION_CHECK_FAILURE_TTL_MS
      : this.#options.ttlMs ?? DEFAULT_VERSION_CHECK_TTL_MS;
    if (this.#now() - entry.at >= ttl) {
      this.#cache.delete(name);
      return undefined;
    }
    return entry;
  }

  #lookup(name: string): Promise<LookupResult> {
    const existing = this.#fresh(name);
    if (existing) return existing.result;
    const timeoutMs = this.#options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS;
    const fetched = Promise.resolve()
      .then(() => this.#fetcher(name, { cwd: this.#options.projectRoot, timeoutMs }))
      .then((info): LookupResult => info === undefined ? 'failed' : info, (): LookupResult => 'failed');
    const entry: CacheEntry = {
      at: this.#now(),
      result: withTimeout(fetched, timeoutMs, 'failed' as const).then(result => {
        entry.settled = result;
        return result;
      }),
    };
    this.#cache.set(name, entry);
    return entry.result;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), ms);
    timer.unref?.();
    void promise.then(value => { clearTimeout(timer); resolve(value); });
  });
}

/**
 * npm package names (validate-npm-package-name rules for new packages): names come from the
 * project's `package.json` and reach a shell on Windows, so anything else is never queried.
 */
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;

/** Parses `npm view <name> dist-tags versions --json`. */
export function parseNpmViewVersions(output: string): RegistryPackageInfo | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(output); } catch { return undefined; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const record = parsed as { 'dist-tags'?: unknown; versions?: unknown };
  const tags = record['dist-tags'];
  const latest = tags && typeof tags === 'object' && typeof (tags as { latest?: unknown }).latest === 'string'
    ? (tags as { latest: string }).latest
    : null;
  // A package with one release prints `versions` as a string.
  const raw = typeof record.versions === 'string' ? [record.versions] : Array.isArray(record.versions) ? record.versions : [];
  const versions = raw.filter((version): version is string => typeof version === 'string');
  if (latest === null && versions.length === 0) return undefined;
  return Object.freeze({ latest, versions: Object.freeze(versions) });
}

/** Default fetcher: `npm view` in the project root, so the project's npm configuration picks the registry. */
export const npmViewRegistryFetcher: RegistryFetcher = (name, { cwd, timeoutMs }) => {
  if (name.length > 214 || !NPM_PACKAGE_NAME.test(name)) return Promise.resolve(undefined);
  return new Promise(resolve => {
    try {
      execFile('npm', ['view', name, 'dist-tags', 'versions', '--json'], {
        cwd,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        shell: process.platform === 'win32',
        env: { ...process.env, npm_config_update_notifier: 'false', npm_config_fund: 'false' },
      }, (error, stdout, stderr) => {
        // `npm view` of an unpublished name exits with E404: the registry answered.
        if (error) resolve(/\bE404\b/u.test(`${stderr ?? ''}\n${stdout ?? ''}`) ? null : undefined);
        else resolve(parseNpmViewVersions(stdout) ?? null);
      });
    } catch {
      resolve(undefined);
    }
  });
};
