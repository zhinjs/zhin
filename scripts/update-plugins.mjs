#!/usr/bin/env node

/**
 * 从 npm registry 获取 Zhin.js 生态插件数据
 * 输出到 docs/public/plugins.json
 *
 * 官方插件以 workspace 为准：只收录 plugins/<分类>/<包>/package.json 中
 * `zhin.type` 为 plugin / adapter 的公开包（框架包、Feature 包、已删除的包都不是插件）。
 * 社区插件来自 npm 搜索（zhin.js-* 命名）。
 *
 * 用法: node scripts/update-plugins.mjs
 *
 * 增强功能：
 * - 下载量统计（周/月/总）
 * - README 摘要（前 200 字）
 * - 兼容性信息（engines、peerDependencies）
 * - 许可证信息
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../docs/public/plugins.json');

// 并发控制：避免同时发起过多请求
const CONCURRENCY = 5;

// ---- 官方插件：workspace 中真实存在的插件包 ----

const PLUGINS_ROOT = resolve(__dirname, '../plugins');
const PLUGIN_TYPES = new Set(['plugin', 'adapter']);
// plugins/<dir> -> category
const CATEGORY_BY_DIR = {
  adapters: 'adapter',
  services: 'service',
  games: 'game',
  features: 'feature',
  utils: 'util',
};

/**
 * @param {string} [root]
 * @returns {Map<string, { category: string, manifest: Record<string, any>, dir: string }>}
 */
export function collectWorkspacePlugins(root = PLUGINS_ROOT) {
  const found = new Map();
  if (!existsSync(root)) return found;
  for (const group of readdirSync(root, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    const category = CATEGORY_BY_DIR[group.name];
    if (!category) continue;
    for (const entry of readdirSync(resolve(root, group.name), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = resolve(root, group.name, entry.name, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.private || typeof manifest.name !== 'string') continue;
      if (!PLUGIN_TYPES.has(manifest.zhin?.type)) continue;
      found.set(manifest.name, { category, manifest, dir: `plugins/${group.name}/${entry.name}` });
    }
  }
  return found;
}

// ---- 社区插件分类（官方插件的分类来自 workspace 目录） ----

function getCommunityCategory(name, keywords = []) {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('adapter-')) return 'adapter';
  const kwSet = new Set(keywords.map(k => k.toLowerCase()));
  if (kwSet.has('adapter')) return 'adapter';
  if (kwSet.has('game')) return 'game';
  if (kwSet.has('service')) return 'service';
  if (kwSet.has('feature')) return 'feature';
  return 'util';
}

// ---- npm 搜索 ----

async function searchNpm(query, size = 100) {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${size}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`npm search failed for "${query}": ${res.status}`);
  const data = await res.json();
  return data.objects || [];
}

// ---- npm 包详情（获取 README、engines、peerDeps、license） ----

async function fetchPackageDetail(name) {
  try {
    const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const latest = data['dist-tags']?.latest;
    const latestVersion = latest ? data.versions?.[latest] : null;

    // 提取 README 摘要（前 200 字，去除 markdown 标记）
    let readme = '';
    if (data.readme) {
      readme = data.readme
        .replace(/^#.*$/gm, '')         // 去除标题
        .replace(/!\[.*?\]\(.*?\)/g, '') // 去除图片
        .replace(/\[([^\]]*)\]\(.*?\)/g, '$1') // 链接只保留文本
        .replace(/[`*_~]/g, '')          // 去除格式标记
        .replace(/\n{2,}/g, '\n')        // 合并多个换行
        .trim()
        .slice(0, 200);
    }

    return {
      readme,
      version: latest || '',
      homepage: latestVersion?.homepage || '',
      description: latestVersion?.description || data.description || '',
      keywords: latestVersion?.keywords || [],
      lastUpdate: (latest && data.time?.[latest]) || data.time?.modified || '',
      author: latestVersion?._npmUser?.name || (typeof latestVersion?.author === 'string' ? latestVersion.author : latestVersion?.author?.name) || '',
      license: data.license || latestVersion?.license || '',
      engines: latestVersion?.engines || {},
      peerDependencies: latestVersion?.peerDependencies || {},
    };
  } catch {
    return null;
  }
}

// ---- npm 下载量 ----

async function fetchDownloads(name) {
  try {
    const [weekRes, monthRes] = await Promise.all([
      fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`),
      fetch(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`),
    ]);
    // null = the downloads API was unreachable; the caller keeps the previous numbers.
    if (!weekRes.ok || !monthRes.ok) return null;
    const week = (await weekRes.json()).downloads || 0;
    const month = (await monthRes.json()).downloads || 0;
    return { weekly: week, monthly: month };
  } catch {
    return null;
  }
}

// ---- 并发执行 ----

async function processBatch(items, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ---- 主逻辑 ----

/** Download counts from the existing plugins.json, used when the downloads API is unreachable. */
function readPreviousDownloads() {
  const previous = new Map();
  try {
    for (const plugin of JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')).plugins ?? []) {
      if (plugin?.name && plugin.downloads) previous.set(plugin.name, plugin.downloads);
    }
  } catch {
    // no previous file
  }
  return previous;
}

async function main() {
  console.log('Fetching plugins from npm...');
  const previousDownloads = readPreviousDownloads();

  const workspacePlugins = collectWorkspacePlugins();
  const communityResults = await searchNpm('zhin.js plugin', 100);

  const basicPlugins = [];

  // 官方：workspace 是事实来源；未发布到 npm 的包稍后按 404 跳过
  for (const [name, { category, manifest, dir }] of workspacePlugins) {
    basicPlugins.push({
      name,
      displayName: name.replace('@zhin.js/', '').replace(/^adapter-/, ''),
      description: manifest.description || '',
      author: '',
      isOfficial: true,
      category,
      version: '',
      npm: `https://www.npmjs.com/package/${name}`,
      github: `https://github.com/zhinjs/zhin/tree/main/${dir}`,
      homepage: '',
      tags: manifest.keywords || [],
      lastUpdate: '',
    });
  }

  // 社区：npm 搜索到的 zhin.js-* 包
  const seen = new Set();
  for (const obj of communityResults) {
    const pkg = obj.package;
    const name = pkg.name;
    if (!name.startsWith('zhin.js-') || seen.has(name)) continue;
    seen.add(name);

    let author = 'Unknown';
    if (pkg.publisher?.username) author = pkg.publisher.username;
    else if (typeof pkg.author === 'string') author = pkg.author;
    else if (pkg.author?.name) author = pkg.author.name;

    basicPlugins.push({
      name,
      displayName: name.replace('zhin.js-', ''),
      description: pkg.description || '',
      author,
      isOfficial: false,
      category: getCommunityCategory(name, pkg.keywords || []),
      version: pkg.version || '',
      npm: pkg.links?.npm || `https://www.npmjs.com/package/${name}`,
      github: pkg.links?.repository || '',
      homepage: pkg.links?.homepage || '',
      tags: pkg.keywords || [],
      lastUpdate: pkg.date || '',
    });
  }

  console.log(`Found ${basicPlugins.length} plugins, fetching details...`);

  // 并发获取详情和下载量
  const details = await processBatch(basicPlugins, async (p) => {
    const [detail, downloads] = await Promise.all([
      fetchPackageDetail(p.name),
      fetchDownloads(p.name),
    ]);
    return { ...p, detail, downloads };
  });

  // 组装最终数据；官方包若未发布到 npm（registry 404）则不收录
  const unpublished = details.filter(({ detail, isOfficial }) => isOfficial && !detail?.version);
  if (unpublished.length > 0) {
    console.warn(`Skipped ${unpublished.length} unpublished workspace plugin(s): ${unpublished.map(p => p.name).join(', ')}`);
  }
  const plugins = details.filter(({ detail, isOfficial }) => !isOfficial || detail?.version).map(({ detail, downloads, ...base }) => ({
    ...base,
    ...(base.isOfficial
      ? {
          version: detail.version,
          description: detail.description || base.description,
          author: detail.author || 'Unknown',
          tags: detail.keywords?.length ? detail.keywords : base.tags,
          lastUpdate: detail.lastUpdate,
          homepage: detail.homepage,
        }
      : {}),
    downloads: downloads || previousDownloads.get(base.name) || { weekly: 0, monthly: 0 },
    readme: detail?.readme || '',
    license: detail?.license || '',
    engines: detail?.engines || {},
    peerDependencies: detail?.peerDependencies || {},
  }));

  // 排序：官方优先，官方内按下载量降序，社区按下载量降序
  plugins.sort((a, b) => {
    if (a.isOfficial && !b.isOfficial) return -1;
    if (!a.isOfficial && b.isOfficial) return 1;
    return (b.downloads.monthly || 0) - (a.downloads.monthly || 0);
  });

  // 统计
  const stats = {
    total: plugins.length,
    official: plugins.filter(p => p.isOfficial).length,
    community: plugins.filter(p => !p.isOfficial).length,
    adapters: plugins.filter(p => p.category === 'adapter').length,
    services: plugins.filter(p => p.category === 'service').length,
    utils: plugins.filter(p => p.category === 'util').length,
    games: plugins.filter(p => p.category === 'game').length,
    features: plugins.filter(p => p.category === 'feature').length,
  };

  const output = { plugins, stats, updatedAt: new Date().toISOString() };

  // 确保输出目录存在
  const outDir = dirname(OUTPUT_PATH);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Done. ${stats.total} plugins written to ${OUTPUT_PATH}`);
  console.log(`  official: ${stats.official}, community: ${stats.community}`);
  console.log(`  adapters: ${stats.adapters}, services: ${stats.services}, utils: ${stats.utils}, games: ${stats.games}, features: ${stats.features}`);
}

// Only run when executed directly, so tests can import collectWorkspacePlugins.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Failed to update plugins:', err);
    process.exit(1);
  });
}
