import type { ConsolePrincipal } from '@zhin.js/host-http';
import { CONSOLE_PERMISSIONS, grantsAllow } from '@zhin.js/console-protocol';
import {
  ADAPTERS,
  AI_STACK_VERSIONS,
  DATABASE_DIALECT_DEFINITIONS,
  ZHIN_STACK_VERSIONS,
} from '@zhin.js/scaffold-wizard';
import { OnboardingError } from './errors.js';

/** Where an allowlisted package comes from (ADR 0053 §3). */
export type InstallPackageKind = 'database-driver' | 'adapter' | 'ai' | 'market';

export interface InstallAllowlistEntry {
  readonly name: string;
  readonly kind: InstallPackageKind;
  /** Range / dist-tag used when a request names no version (`latest` → bare name). */
  readonly defaultVersion?: string;
}

/** One plugin-market entry; the catalog source (plugins.json, registry) is the caller's. */
export interface MarketCatalogEntry {
  readonly name: string;
  readonly version?: string;
}

export interface InstallAllowlist {
  get(name: string): InstallAllowlistEntry | undefined;
  entries(): readonly InstallAllowlistEntry[];
}

/** A request that passed parsing and the allowlist. `spec` is what the package manager receives. */
export interface AuthorizedPackage {
  readonly name: string;
  readonly kind: InstallPackageKind;
  readonly version?: string;
  readonly spec: string;
}

const NAME = /^(?:@[a-z0-9][a-z0-9._-]{0,213}\/)?[a-z0-9][a-z0-9._-]{0,213}$/u;
// One comparator without whitespace: 1.2.3, ^1.2.3, ~1.2, >=1.0.0, 1.x, with an optional prerelease.
const SEMVER_RANGE = /^(?:[~^]|[<>]=?|=)?\d{1,9}(?:\.(?:\d{1,9}|x|\*)){0,2}(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,63})?$/u;
// npm dist-tags must not look like a version or a path.
const DIST_TAG = /^[a-z][a-z0-9-]{0,31}$/u;

export function isSafeVersionSpec(version: string): boolean {
  return SEMVER_RANGE.test(version) || DIST_TAG.test(version) || version === '*';
}

/**
 * Parses `name` or `name@version` strictly. Anything else (URLs, paths, git / file / npm: aliases,
 * whitespace, shell syntax) is rejected; there is no fallback interpretation.
 */
export function parseInstallRequest(request: unknown): { readonly name: string; readonly version?: string } {
  if (typeof request !== 'string' || request.length === 0 || request.length > 256) {
    throw new OnboardingError('invalid_input', '包名无效');
  }
  const at = request.indexOf('@', request.startsWith('@') ? 1 : 0);
  const name = at < 0 ? request : request.slice(0, at);
  const version = at < 0 ? undefined : request.slice(at + 1);
  if (!NAME.test(name) || name.includes('..')) throw new OnboardingError('invalid_input', `包名无效：${name.slice(0, 64)}`);
  if (version !== undefined && !isSafeVersionSpec(version)) {
    throw new OnboardingError('invalid_input', `${name} 的版本只能是 semver 范围或 dist-tag`);
  }
  return Object.freeze({ name, ...(version === undefined ? {} : { version }) });
}

export interface InstallAllowlistOptions {
  /** Plugin-market entries; names that fail parsing are dropped. */
  readonly market?: readonly MarketCatalogEntry[];
}

/** Official catalog: database drivers, adapter packages (+ their extra deps), AI stack, market entries. */
export function createInstallAllowlist(options: InstallAllowlistOptions = {}): InstallAllowlist {
  const map = new Map<string, InstallAllowlistEntry>();
  const add = (name: string, kind: InstallPackageKind, version?: string) => {
    if (map.has(name) || !NAME.test(name)) return;
    const defaultVersion = version && version !== 'latest' && isSafeVersionSpec(version) ? version : undefined;
    map.set(name, Object.freeze({ name, kind, ...(defaultVersion ? { defaultVersion } : {}) }));
  };
  // Order matters: a driver stays a driver even if a later catalog also lists it.
  for (const definition of DATABASE_DIALECT_DEFINITIONS) {
    if (definition.driver) add(definition.driver.package, 'database-driver', definition.driver.version);
  }
  const stack = ZHIN_STACK_VERSIONS as Readonly<Record<string, string>>;
  for (const adapter of ADAPTERS) {
    add(adapter.package, 'adapter', stack[adapter.package]);
    for (const [name, version] of Object.entries(adapter.extraDeps ?? {})) add(name, 'adapter', version);
  }
  for (const [name, version] of Object.entries(AI_STACK_VERSIONS)) add(name, 'ai', version);
  // AI authoring conventions the wizard adds with the agent (collectWizardDependencies).
  for (const name of ['@zhin.js/tool', '@zhin.js/prompt-section']) add(name, 'ai', stack[name]);
  for (const entry of options.market ?? []) {
    if (entry && typeof entry.name === 'string') add(entry.name, 'market', entry.version);
  }
  const entries = Object.freeze([...map.values()]);
  return Object.freeze({
    get: (name: string) => map.get(name),
    entries: () => entries,
  });
}

/**
 * A Console principal, or `'local'` for the CLI: the operator already has shell access to the
 * project, so only the allowlist and spec rules apply.
 */
export type InstallPrincipal = ConsolePrincipal | 'local';

export interface AuthorizeInstallOptions {
  /** True once an owner exists; the bootstrap token is refused afterwards. */
  readonly ownerExists?: boolean;
}

/**
 * ADR 0053 §3: only allowlisted packages; the bootstrap token may install database drivers only
 * (and only before the first owner exists); everything else needs `plugin.manage`. Deny by default.
 */
export function authorizeInstall(
  packages: readonly unknown[],
  principal: InstallPrincipal | undefined,
  allowlist: InstallAllowlist,
  options: AuthorizeInstallOptions = {},
): readonly AuthorizedPackage[] {
  if (!principal) throw new OnboardingError('forbidden', '未登录');
  if (!Array.isArray(packages) || packages.length === 0 || packages.length > 32) {
    throw new OnboardingError('invalid_input', '请提供 1–32 个包');
  }
  const seen = new Set<string>();
  const authorized: AuthorizedPackage[] = [];
  for (const request of packages) {
    const { name, version } = parseInstallRequest(request);
    const entry = allowlist.get(name);
    if (!entry) throw new OnboardingError('forbidden', `${name} 不在可安装目录中`);
    if (seen.has(name)) throw new OnboardingError('invalid_input', `重复的包：${name}`);
    seen.add(name);
    if (principal === 'local') {
      // Allowlist and spec checks above still apply.
    } else if (principal.kind === 'bootstrap') {
      if (options.ownerExists) throw new OnboardingError('forbidden', '已创建所有者：初始化令牌已失效');
      if (entry.kind !== 'database-driver') throw new OnboardingError('forbidden', '初始化令牌只能安装数据库驱动');
    } else if (!grantsAllow(principal.grants, CONSOLE_PERMISSIONS.PLUGIN_MANAGE)) {
      throw new OnboardingError('forbidden', `安装 ${name} 需要 ${CONSOLE_PERMISSIONS.PLUGIN_MANAGE} 权限`);
    }
    const resolved = version ?? entry.defaultVersion;
    authorized.push(Object.freeze({
      name,
      kind: entry.kind,
      ...(resolved === undefined ? {} : { version: resolved }),
      spec: resolved === undefined ? name : `${name}@${resolved}`,
    }));
  }
  return Object.freeze(authorized);
}
