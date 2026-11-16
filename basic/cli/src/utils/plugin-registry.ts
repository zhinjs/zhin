import { execFileSync } from 'node:child_process';
import {
  findAdapterByPackage,
  type AdapterDefinition,
} from '@zhin.js/scaffold-wizard';
import {
  informativeKeywords,
  normalizePluginCategory,
  readPluginMarketplaceMetadata,
} from '@zhin.js/plugin-runtime';
import { stripNpmVersion } from '../commands/install.js';

/** 插件生态包分类 */
export type PluginKind = 'adapter' | 'plugin' | 'skill-pack';

export interface PackageClassification {
  /** @zhin.js scope 视为官方 */
  official: boolean;
  /** 命中已知适配器/官方插件命名约定时标注类型 */
  kind: PluginKind | null;
}

/**
 * 按包名/keywords 分类：official/community + adapter/plugin/skill-pack
 */
export function classifyPackage(pkg: { name: string; keywords?: string[] }): PackageClassification {
  const { name } = pkg;
  const official = name.startsWith('@zhin.js/');
  let kind: PluginKind | null = null;
  if (name.startsWith('@zhin.js/adapter-') || findAdapterByPackage(name)) {
    kind = 'adapter';
  } else if (name.startsWith('@zhin.js/plugin-') || name.startsWith('zhin.js-plugin-')) {
    kind = 'plugin';
  } else if ((pkg.keywords ?? []).includes('zhin-package')) {
    kind = 'skill-pack';
  }
  return { official, kind };
}

/**
 * 格式化标签：`[official] [adapter]` / `[community]` 等
 */
export function formatPackageBadge(classification: PackageClassification): string {
  const scope = classification.official ? '[official]' : '[community]';
  return classification.kind ? `${scope} [${classification.kind}]` : scope;
}

export interface NpmSearchResult {
  name: string;
  version?: string;
  description?: string;
  keywords?: string[];
  /** npm search: `package.json#author` (may be absent from search documents). */
  author?: string | { name?: string };
  maintainers?: Array<{ name?: string; username?: string } | string>;
  /** The account that published the version (the release bot for CI publishes); never shown as the author. */
  publisher?: { username?: string };
  /** Published `package.json#zhin` (present in `npm view`, usually absent from search). */
  zhin?: unknown;
  date?: string;
  downloads?: string | number;
  [key: string]: unknown;
}

export interface NpmPackageInfo extends NpmSearchResult {
  time?: { modified?: string; created?: string };
  homepage?: string;
  repository?: { url?: string };
  bugs?: { url?: string };
  license?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface SearchFilterOptions {
  keyword?: string;
  category?: string;
  limit?: number;
}

/**
 * Keywords that mark a package as part of the Zhin ecosystem. `zhin.js` is what the authoring docs
 * recommend (plus feature words); `zhin` / `zhinjs` / `zhin-plugin` / `zhin-package` are also
 * accepted. Matching is case-insensitive. The generic `plugin` is deliberately absent (#1250): it
 * let unrelated npm packages (`@maptiler/weather`) through as installable Zhin plugins. Official
 * `@zhin.js/*` and conventional `zhin.js-*` packages match by name, whatever their keywords.
 */
export const ZHIN_ECOSYSTEM_KEYWORDS: readonly string[] = Object.freeze(['zhin.js', 'zhin', 'zhinjs', 'zhin-plugin', 'zhin-package']);

/**
 * Whether an npm search result belongs to the Zhin ecosystem: a recognised keyword, an official or
 * conventional package name, or a published `package.json#zhin` manifest (when the search document
 * carries it).
 */
export function isZhinEcosystemPackage(pkg: NpmSearchResult): boolean {
  if (pkg.name.startsWith('@zhin.js/') || pkg.name.startsWith('zhin.js-')) return true;
  if (pkg.zhin !== undefined && pkg.zhin !== null && typeof pkg.zhin === 'object') return true;
  const keywords = (pkg.keywords ?? []).map((keyword) => String(keyword).toLowerCase());
  return keywords.some((keyword) => ZHIN_ECOSYSTEM_KEYWORDS.includes(keyword));
}

/**
 * 过滤 + 排序 npm search 结果（纯函数，便于测试）
 */
export function filterSearchResults(results: NpmSearchResult[], options: SearchFilterOptions): NpmSearchResult[] {
  let filtered = results.filter((pkg) => {
    const keywords = pkg.keywords || [];
    if (!isZhinEcosystemPackage(pkg)) return false;

    if (options.category && !matchesCategory(pkg, options.category)) return false;

    if (options.keyword) {
      const market = readPluginMarketplaceMetadata(pkg.zhin);
      const searchIn = [
        pkg.name,
        pkg.description || '',
        market.displayName ?? '',
        ...Object.values(market.displayNameI18n ?? {}),
        ...Object.values(market.descriptionI18n ?? {}),
        ...informativeKeywords(keywords),
      ].join(' ').toLowerCase();
      return searchIn.includes(options.keyword.toLowerCase());
    }
    return true;
  });

  filtered = filtered.slice().sort((a, b) => {
    const aDownloads = parseInt(String(a.downloads || '0'), 10);
    const bDownloads = parseInt(String(b.downloads || '0'), 10);
    return bDownloads - aDownloads;
  });

  const limit = options.limit ?? 20;
  if (filtered.length > limit) filtered = filtered.slice(0, limit);
  return filtered;
}

/**
 * npm search queries of `zhin search` (#1250): the text query, plus a `@zhin.js` scope query when a
 * keyword is given so official packages are found even when unrelated packages fill the text
 * query's result page (the ecosystem filter no longer lets generic `plugin` packages through).
 */
export function zhinSearchQueries(keyword: string | undefined, official = false): string[] {
  if (official) return ['@zhin.js'];
  const trimmed = keyword?.trim();
  if (!trimmed) return ['zhin.js plugin', '@zhin.js'];
  return [`zhin.js ${trimmed}`, `@zhin.js ${trimmed}`];
}

/** Concatenates npm search pages, keeping the first entry for each package name. */
export function mergeSearchResults(pages: readonly (readonly NpmSearchResult[])[]): NpmSearchResult[] {
  const seen = new Set<string>();
  const merged: NpmSearchResult[] = [];
  for (const page of pages) {
    for (const pkg of page) {
      if (!pkg || typeof pkg.name !== 'string' || seen.has(pkg.name)) continue;
      seen.add(pkg.name);
      merged.push(pkg);
    }
  }
  return merged;
}

/**
 * 分类匹配：优先读发布清单的 `zhin.metadata.category`（接受旧别名如 util）；
 * 没有声明分类的包（npm search 结果通常不含 zhin 字段）退回到包名约定与 keywords。
 */
function matchesCategory(pkg: NpmSearchResult, wanted: string): boolean {
  const category = normalizePluginCategory(wanted) ?? wanted;
  const declared = readPluginMarketplaceMetadata(pkg.zhin).category;
  if (declared) return declared === category;
  if (category === 'adapter' && classifyPackage(pkg).kind === 'adapter') return true;
  return (pkg.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(wanted.toLowerCase()));
}

/** npm search（IO 包装，测试中不直接调用） */
export function npmSearch(query: string): NpmSearchResult[] {
  const output = execFileSync('npm', ['search', query, '--json'], {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  return JSON.parse(output);
}

/**
 * `npm view` failed (#1250 `cli-info-local-workspace-plugin`): `notFound` when the registry has no
 * such package (E404), otherwise the registry could not be reached or answered with an error. The
 * message is meant for users; the raw `Command failed: npm view …` text is never shown.
 */
export class NpmViewError extends Error {
  readonly notFound: boolean;
  constructor(readonly packageName: string, notFound: boolean, readonly detail?: string) {
    super(notFound
      ? `npm registry 上没有 ${packageName}`
      : `无法从 npm registry 查询 ${packageName}${detail ? `（${detail}）` : ''}`);
    this.name = 'NpmViewError';
    this.notFound = notFound;
  }
}

/**
 * Classifies a failed `npm view <name> --json` run: npm writes `{ "error": { "code": "E404", … } }`
 * to stdout with `--json`, so the code says whether the package is missing or the lookup failed.
 */
export function npmViewFailure(packageName: string, error: unknown): NpmViewError {
  const stdout = (error as { stdout?: unknown } | undefined)?.stdout;
  let code: string | undefined;
  let summary: string | undefined;
  if (typeof stdout === 'string' && stdout.trim()) {
    try {
      const parsed = JSON.parse(stdout) as { error?: { code?: unknown; summary?: unknown } };
      if (typeof parsed?.error?.code === 'string') code = parsed.error.code;
      if (typeof parsed?.error?.summary === 'string') summary = parsed.error.summary.split('\n')[0]?.trim();
    } catch { /* not npm's JSON error document */ }
  }
  if (code === 'E404' || /\bE404\b|404 Not Found/u.test(String(stdout ?? ''))) return new NpmViewError(packageName, true);
  if ((error as { code?: unknown } | undefined)?.code === 'ENOENT') return new NpmViewError(packageName, false, '找不到 npm 命令');
  return new NpmViewError(packageName, false, code ?? summary ?? '网络或 registry 不可用');
}

/** npm view（IO 包装）；失败时抛出 {@link NpmViewError}。 */
export function npmView(name: string): NpmPackageInfo {
  let output: string;
  try {
    output = execFileSync('npm', ['view', name, '--json'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch (error) {
    throw npmViewFailure(name, error);
  }
  const parsed: unknown = JSON.parse(output);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(`npm view returned an invalid package document for ${name}`);
  }
  const info = parsed as Record<string, unknown>;
  if (typeof info.name !== 'string' || info.name.length === 0) {
    throw new TypeError(`npm view returned a package without a name for ${name}`);
  }
  return info as unknown as NpmPackageInfo;
}

/** npm registry 周下载量；失败时返回 null（非致命） */
export async function fetchWeeklyDownloads(name: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { downloads?: unknown };
    return typeof data.downloads === 'number' ? data.downloads : null;
  } catch {
    return null;
  }
}

/** install 分流：a) 已知适配器 b) 其他 npm 包 c) npm:/git: 前缀的 zhin-package 技能包 */
export type InstallRoute = 'skill-pack' | 'adapter' | 'npm';

export interface ResolvedInstall {
  route: InstallRoute;
  /** 规范化后的 npm 包名；skill-pack 路由保留原始 source */
  package: string;
  adapter?: AdapterDefinition;
}

export function resolveInstallRoute(spec: string): ResolvedInstall {
  if (spec.startsWith('npm:') || spec.startsWith('git:')) {
    return { route: 'skill-pack', package: spec };
  }
  const name = stripNpmVersion(spec);
  const adapter = findAdapterByPackage(name);
  if (adapter) {
    return { route: 'adapter', package: name, adapter };
  }
  return { route: 'npm', package: name };
}

/** 官方适配器的一行配置入口提示 */
export function adapterConfigHint(def: AdapterDefinition): string {
  const doc = def.docUrl ? `（文档: ${def.docUrl}）` : '';
  return `运行 \`zhin setup\` 交互配置凭据，或在 zhin.config.yml 的 ${def.value}.endpoints 下手动添加 Endpoint${doc}`;
}

/** 按包名取适配器配置入口提示；非已知适配器返回 null */
export function adapterConfigHintForPackage(packageName: string): string | null {
  const def = findAdapterByPackage(packageName);
  return def ? adapterConfigHint(def) : null;
}
