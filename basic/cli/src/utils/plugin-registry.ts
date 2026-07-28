import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'fs-extra';
import {
  findAdapterByPackage,
  mergePluginManifestIntoPackageJson,
  packageToInstanceKey,
  type AdapterDefinition,
} from '@zhin.js/scaffold-wizard';
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
  publisher?: { username?: string };
  date?: string;
  downloads?: string | number;
  [key: string]: unknown;
}

export interface NpmPackageInfo extends NpmSearchResult {
  author?: { name?: string };
  maintainers?: Array<{ name?: string }>;
  time?: { modified?: string; created?: string };
  homepage?: string;
  repository?: { url?: string };
  bugs?: { url?: string };
  license?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  zhin?: {
    displayName?: string;
    category?: string;
    features?: string[];
  };
}

export interface SearchFilterOptions {
  keyword?: string;
  category?: string;
  limit?: number;
}

/**
 * 过滤 + 排序 npm search 结果（纯函数，便于测试）
 */
export function filterSearchResults(results: NpmSearchResult[], options: SearchFilterOptions): NpmSearchResult[] {
  let filtered = results.filter((pkg) => {
    const keywords = pkg.keywords || [];
    const hasZhin =
      keywords.includes('zhin') ||
      keywords.includes('plugin') ||
      pkg.name.startsWith('@zhin.js/') ||
      pkg.name.startsWith('zhin.js-');
    if (!hasZhin) return false;

    if (options.category) {
      const category = keywords.find((k) => k.includes(options.category!));
      if (!category) return false;
    }

    if (options.keyword) {
      const searchIn = [pkg.name, pkg.description || '', ...keywords].join(' ').toLowerCase();
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

/** 读取已安装包的 package.json zhin 字段（判断是否 zhin 插件） */
export function readInstalledZhinField(cwd: string, packageName: string): Record<string, unknown> | null {
  try {
    const pkgPath = path.join(cwd, 'node_modules', packageName, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    const pkg = fs.readJsonSync(pkgPath) as { zhin?: unknown };
    return pkg.zhin && typeof pkg.zhin === 'object' && !Array.isArray(pkg.zhin)
      ? (pkg.zhin as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** 把插件注册进项目 package.json 的 zhin.plugins 清单（2 空格缩进，由 mergePluginManifestIntoPackageJson 保证） */
export async function registerPluginInManifest(cwd: string, packageName: string): Promise<boolean> {
  return mergePluginManifestIntoPackageJson(cwd, [
    { package: packageName, instanceKey: packageToInstanceKey(packageName) },
  ]);
}

/** 官方适配器的一行配置入口提示 */
export function adapterConfigHint(def: AdapterDefinition): string {
  const doc = def.docUrl ? `（文档: ${def.docUrl}）` : '';
  return `运行 \`zhin setup\` 交互配置凭据，或在 zhin.config.yml 的 plugins.${def.value}.endpoints 下手动添加 Endpoint${doc}`;
}

/** 按包名取适配器配置入口提示；非已知适配器返回 null */
export function adapterConfigHintForPackage(packageName: string): string | null {
  const def = findAdapterByPackage(packageName);
  return def ? adapterConfigHint(def) : null;
}
