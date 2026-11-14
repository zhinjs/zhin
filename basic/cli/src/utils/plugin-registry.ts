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
 * recommend (plus feature words); `zhin` / `zhinjs` / `zhin-plugin` and the legacy generic `plugin`
 * are still accepted. Matching is case-insensitive.
 */
export const ZHIN_ECOSYSTEM_KEYWORDS: readonly string[] = Object.freeze(['zhin.js', 'zhin', 'zhinjs', 'zhin-plugin', 'plugin']);

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

/** npm view（IO 包装） */
export function npmView(name: string): NpmPackageInfo {
  const output = execFileSync('npm', ['view', name, '--json'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'ignore'],
  });
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
