/**
 * `@zhin.js/*` packages that were merged into another package or removed (#1250
 * `retired-package-not-flagged`). Their last releases stay on the registry and keep depending on
 * old Zhin releases: a project that still declares one installs a second copy of
 * `@zhin.js/runtime` / `@zhin.js/plugin-runtime` and fails the single-instance check, which no
 * `pnpm.overrides` entry fixes for good. `zhin doctor` and `zhin migrate` read this catalog to
 * name the replacement and tell the user to drop the dependency.
 *
 * Each entry is backed by the repository history (the commit or changelog that merged or deleted
 * the package); `docs/migrations/retired-packages.md` holds the same table for readers.
 */

/** One import rewrite: `from` is the retired specifier, `to` the replacement specifier. */
export interface RetiredPackageImport {
  readonly from: string;
  readonly to: string;
  /** Exports that moved, for messages (e.g. `YamlConfigDocument`). Empty: everything moved. */
  readonly symbols: readonly string[];
}

export interface RetiredZhinPackage {
  readonly name: string;
  /** `merged`: the code lives on in `replacement`; `removed`: deleted (`replacement`, when set, is the package that took over its role). */
  readonly status: 'merged' | 'removed';
  /** The package to depend on instead (absent when nothing replaces it). */
  readonly replacement?: string;
  /** Import rewrites for a merged package (`from` covers subpaths: `from/x` → `to/x`). */
  readonly imports: readonly RetiredPackageImport[];
  /** What to do, as one Chinese sentence (shown by doctor and migrate). */
  readonly action: string;
}

/** Retired `@zhin.js/*` packages, sorted by name. */
export const RETIRED_ZHIN_PACKAGES: readonly RetiredZhinPackage[] = Object.freeze([
  {
    name: '@zhin.js/ai-provider',
    status: 'merged',
    replacement: '@zhin.js/ai',
    imports: [{ from: '@zhin.js/ai-provider', to: '@zhin.js/ai/provider', symbols: [] }],
    action: '已并入 @zhin.js/ai：把 import 从 @zhin.js/ai-provider 改成 @zhin.js/ai/provider，然后删除 @zhin.js/ai-provider 依赖',
  },
  {
    name: '@zhin.js/config-file',
    status: 'merged',
    replacement: '@zhin.js/runtime',
    imports: [{ from: '@zhin.js/config-file', to: '@zhin.js/runtime', symbols: ['YamlConfigDocument', 'JsonConfigDocument', 'createConfigDocument'] }],
    action: '已并入 @zhin.js/runtime：把 import 从 @zhin.js/config-file 改成 @zhin.js/runtime（或 @zhin.js/runtime/config-file），然后删除 @zhin.js/config-file 依赖',
  },
  {
    name: '@zhin.js/config-yaml',
    status: 'merged',
    replacement: '@zhin.js/runtime',
    imports: [{ from: '@zhin.js/config-yaml', to: '@zhin.js/runtime', symbols: ['YamlConfigDocument'] }],
    action: '已停更并入 @zhin.js/runtime：改用 @zhin.js/runtime 的 YamlConfigDocument（import { YamlConfigDocument } from \'@zhin.js/runtime\'），然后删除 @zhin.js/config-yaml 依赖',
  },
  {
    name: '@zhin.js/host-api',
    status: 'removed',
    imports: [],
    action: '已删除：zhin start 自动装配 Console 与 HTTP Host，不再需要 Host 插件；删除 @zhin.js/host-api 依赖及其插件配置',
  },
  {
    name: '@zhin.js/host-router',
    status: 'removed',
    imports: [],
    action: '已删除：HTTP 服务由 zhin start 装配的 @zhin.js/host-http 提供；删除 @zhin.js/host-router 依赖及其插件配置',
  },
  {
    name: '@zhin.js/interaction',
    status: 'merged',
    replacement: '@zhin.js/im-contract',
    imports: [{ from: '@zhin.js/interaction', to: '@zhin.js/im-contract/interaction', symbols: [] }],
    action: '已并入 @zhin.js/im-contract：把 import 从 @zhin.js/interaction 改成 @zhin.js/im-contract/interaction，然后删除 @zhin.js/interaction 依赖',
  },
  {
    name: '@zhin.js/isolate',
    status: 'merged',
    replacement: '@zhin.js/runtime',
    imports: [{ from: '@zhin.js/isolate', to: '@zhin.js/runtime/isolate', symbols: [] }],
    action: '已并入 @zhin.js/runtime：把 import 从 @zhin.js/isolate 改成 @zhin.js/runtime/isolate，然后删除 @zhin.js/isolate 依赖',
  },
  {
    name: '@zhin.js/tools',
    status: 'removed',
    replacement: '@zhin.js/tool',
    imports: [],
    action: '已删除，Tool 创作统一使用 @zhin.js/tool（defineAgentTool，tools/<name>/index.ts）：改写工具定义后删除 @zhin.js/tools 依赖',
  },
  {
    name: '@zhin.js/workroom',
    status: 'removed',
    imports: [],
    action: '已删除：多 Bot 共享的群或频道改在 ai.venues 声明，协作范围写在 agents/<name>/agent.json 的 collaboration；删除 @zhin.js/workroom 依赖',
  },
] satisfies RetiredZhinPackage[]);

const BY_NAME = new Map(RETIRED_ZHIN_PACKAGES.map(entry => [entry.name, entry]));

/** The catalog entry for `name`, or undefined when the package is current. */
export function findRetiredZhinPackage(name: string): RetiredZhinPackage | undefined {
  return BY_NAME.get(name);
}

/** Dependency fields a project declares packages in (checked for retired packages). */
const DECLARING_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

export interface RetiredDependency {
  readonly name: string;
  /** The package.json field that declares it. */
  readonly field: typeof DECLARING_FIELDS[number];
  readonly specifier: string;
  readonly retired: RetiredZhinPackage;
}

/** Retired packages a manifest (`package.json` content) declares directly, in catalog order. */
export function findRetiredDependencies(manifest: unknown): RetiredDependency[] {
  if (!manifest || typeof manifest !== 'object') return [];
  const found: RetiredDependency[] = [];
  for (const field of DECLARING_FIELDS) {
    const deps = (manifest as Record<string, unknown>)[field];
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
    for (const [name, specifier] of Object.entries(deps)) {
      const retired = BY_NAME.get(name);
      if (retired) found.push({ name, field, specifier: String(specifier), retired });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.field.localeCompare(b.field));
}

export interface RetiredImportUse {
  /** 1-based line of the specifier. */
  readonly line: number;
  /** The specifier as written (`@zhin.js/isolate/x`). */
  readonly specifier: string;
  readonly retired: RetiredZhinPackage;
  /** The replacement specifier (subpath kept), when the package was merged into another one. */
  readonly replacement?: string;
}

/**
 * Module specifiers of retired packages in one source text: quoted specifiers after `from`,
 * `import(` / `import`, `require(` (comments and other strings are not matched). Subpaths map
 * along (`@zhin.js/isolate/x` → `@zhin.js/runtime/isolate/x`). Nothing is rewritten: `zhin migrate`
 * lists these as the edits to make by hand.
 */
export function findRetiredImports(source: string): RetiredImportUse[] {
  const uses: RetiredImportUse[] = [];
  const pattern = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])(@zhin\.js\/[a-z0-9-]+)((?:\/[^'"\s]*)?)\2/gu;
  for (const match of source.matchAll(pattern)) {
    const [, , , name, subpath] = match as unknown as [string, string, string, string, string];
    const retired = BY_NAME.get(name);
    if (!retired) continue;
    const rule = retired.imports.find(entry => entry.from === name);
    const line = source.slice(0, match.index).split('\n').length;
    uses.push({ line, specifier: `${name}${subpath}`, retired, ...(rule ? { replacement: `${rule.to}${subpath}` } : {}) });
  }
  return uses;
}
