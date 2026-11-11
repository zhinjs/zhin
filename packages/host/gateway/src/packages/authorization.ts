import type { ConsolePrincipal } from '@zhin.js/host-http';
import {
  CONSOLE_PERMISSIONS,
  grantsAllow,
  type GatewayAuthorizedPackage,
  type GatewayTransactionOperation,
} from '@zhin.js/console-protocol';
import { authorizeInstall, parseInstallRequest, type InstallAllowlist } from '../onboarding/allowlist.js';
import { OnboardingError } from '../onboarding/errors.js';
import { GatewayError } from './errors.js';

/** A Console principal, or `'local'` for the CLI on the local control socket (owner, ADR 0054 §6). */
export type GatewayPrincipal = ConsolePrincipal | 'local';

export type GatewayPackageAction = 'list' | 'plan' | GatewayTransactionOperation;

export interface AuthorizePackagesOptions {
  readonly allowlist: InstallAllowlist;
  /** True once an owner exists: the bootstrap token is refused afterwards. */
  readonly ownerExists: boolean;
}

const MAX_PACKAGES = 32;
const EXACT_VERSION = /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,63})?$/u;

/** A global `owner` binding, or the local control socket. */
export function isGatewayOwner(principal: GatewayPrincipal | undefined): boolean {
  if (principal === 'local') return true;
  if (!principal || principal.kind === 'bootstrap') return false;
  return principal.grants.some(grant => grant.role === 'owner' && grant.scope.kind === 'global');
}

/** Whether the principal holds a global Console permission (bootstrap: only an open, local Host). */
export function gatewayPrincipalAllows(principal: GatewayPrincipal | undefined, permission: string): boolean {
  if (principal === 'local') return true;
  if (!principal) return false;
  if (principal.kind === 'bootstrap') return principal.open;
  return grantsAllow(principal.grants, permission);
}

function rethrow(error: unknown): never {
  if (error instanceof OnboardingError) throw new GatewayError(error.code, error.message, { cause: error });
  throw error;
}

/**
 * Authorizes one package transaction (deny by default):
 * - bootstrap token: `install` of allowlisted database drivers only, before the first owner (ADR 0053 §3);
 * - `plugin.manage` without a global owner binding: allowlisted packages only (ADR 0053 §3);
 * - owners and the local socket: any npm package by name, with the same strict spec rules.
 * `'all'` (update every dependency) is owner-only. `declare` takes bare names, like `uninstall`.
 */
export function authorizePackages(
  principal: GatewayPrincipal | undefined,
  operation: GatewayTransactionOperation,
  requests: readonly unknown[] | 'all',
  options: AuthorizePackagesOptions,
): readonly GatewayAuthorizedPackage[] {
  if (!principal) throw new GatewayError('forbidden', '未登录');
  if (principal !== 'local' && principal.kind === 'bootstrap') {
    if (operation !== 'install' || requests === 'all') throw new GatewayError('forbidden', '初始化令牌只能安装数据库驱动');
    try {
      return Object.freeze(authorizeInstall(requests, principal, options.allowlist, { ownerExists: options.ownerExists })
        .map(item => Object.freeze({ name: item.name, ...(item.version === undefined ? {} : { version: item.version }), spec: item.spec, source: item.kind })));
    } catch (error) { rethrow(error); }
  }
  if (!gatewayPrincipalAllows(principal, CONSOLE_PERMISSIONS.PLUGIN_MANAGE)) {
    throw new GatewayError('forbidden', `需要 ${CONSOLE_PERMISSIONS.PLUGIN_MANAGE} 权限`);
  }
  const owner = isGatewayOwner(principal);
  if (requests === 'all') {
    if (operation !== 'update') throw new GatewayError('invalid_input', '只有 update 可以作用于全部依赖');
    if (!owner) throw new GatewayError('forbidden', '只有所有者可以更新全部依赖');
    return Object.freeze([]);
  }
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > MAX_PACKAGES) {
    throw new GatewayError('invalid_input', `请提供 1–${MAX_PACKAGES} 个包`);
  }
  if (operation === 'install' && !owner) {
    try {
      return Object.freeze(authorizeInstall(requests, principal, options.allowlist)
        .map(item => Object.freeze({ name: item.name, ...(item.version === undefined ? {} : { version: item.version }), spec: item.spec, source: item.kind })));
    } catch (error) { rethrow(error); }
  }
  const seen = new Set<string>();
  const authorized: GatewayAuthorizedPackage[] = [];
  for (const request of requests) {
    let parsed: { readonly name: string; readonly version?: string };
    try { parsed = parseInstallRequest(request); } catch (error) { rethrow(error); }
    const { name } = parsed;
    if (seen.has(name)) throw new GatewayError('invalid_input', `重复的包：${name}`);
    seen.add(name);
    const entry = options.allowlist.get(name);
    if (!owner && !entry) throw new GatewayError('forbidden', `${name} 不在可管理目录中；只有所有者可以管理任意 npm 包`);
    let version = parsed.version;
    if (operation === 'uninstall' && version !== undefined) throw new GatewayError('invalid_input', `卸载 ${name} 时不能指定版本`);
    if (operation === 'declare' && version !== undefined) throw new GatewayError('invalid_input', `声明 ${name} 时不能指定版本`);
    if (operation === 'update' && version !== undefined && !EXACT_VERSION.test(version)) {
      throw new GatewayError('invalid_input', `${name} 的更新版本必须是精确 semver 版本`);
    }
    if (operation === 'install') version ??= entry?.defaultVersion;
    authorized.push(Object.freeze({
      name,
      ...(version === undefined ? {} : { version }),
      spec: version === undefined ? name : `${name}@${version}`,
      source: entry?.kind ?? 'npm',
    }));
  }
  return Object.freeze(authorized);
}
