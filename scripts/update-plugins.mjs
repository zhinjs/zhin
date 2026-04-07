#!/usr/bin/env node

/**
 * 从 npm registry 获取 Zhin.js 生态插件数据
 * 输出到 docs/public/plugins.json
 *
 * 用法: node scripts/update-plugins.mjs
 *
 * 增强功能：
 * - 下载量统计（周/月/总）
 * - README 摘要（前 200 字）
 * - 兼容性信息（engines、peerDependencies）
 * - 许可证信息
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../docs/public/plugins.json');

// 并发控制：避免同时发起过多请求
const CONCURRENCY = 5;

// ---- 核心包排除列表（框架内部包，不是用户插件） ----

const CORE_PACKAGES = new Set([
  '@zhin.js/core',
  '@zhin.js/kernel',
  '@zhin.js/ai',
  '@zhin.js/agent',
  '@zhin.js/cli',
  '@zhin.js/client',
  '@zhin.js/database',
  '@zhin.js/logger',
  '@zhin.js/schema',
  '@zhin.js/types',
  '@zhin.js/satori',
  '@zhin.js/hmr',
  '@zhin.js/dependency',
  '@zhin.js/create-zhin',
  'zhin.js',
]);

// ---- 分类判断 ----
// 分类：adapter | service | util | game | feature
// 基于包名前缀精确匹配，而非关键词子串

function getPluginCategory(name, keywords = []) {
  const lowerName = name.toLowerCase();

  // 适配器：名称含 adapter-
  if (lowerName.includes('adapter-')) return 'adapter';

  // 已知服务插件（与 plugins/services/ 目录对应）
  if (['@zhin.js/http', '@zhin.js/console', '@zhin.js/mcp'].includes(lowerName)) return 'service';

  // 已知特性插件（与 plugins/features/ 目录对应）
  if (['@zhin.js/process-monitor'].includes(lowerName)) return 'feature';

  // 关键字精确匹配（完整词）
  const kwSet = new Set(keywords.map(k => k.toLowerCase()));
  if (kwSet.has('adapter')) return 'adapter';
  if (kwSet.has('game')) return 'game';
  if (kwSet.has('service')) return 'service';
  if (kwSet.has('feature')) return 'feature';

  // plugin-* 命名的默认归为 util
  if (lowerName.includes('plugin-')) return 'util';

  // 名称中含 -filter, -music 等工具类
  if (lowerName.includes('-filter') || lowerName.includes('-music')) return 'util';

  // 兜底：无法归类的官方包当 util，社区包也当 util
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
    const week = weekRes.ok ? (await weekRes.json()).downloads || 0 : 0;
    const month = monthRes.ok ? (await monthRes.json()).downloads || 0 : 0;
    return { weekly: week, monthly: month };
  } catch {
    return { weekly: 0, monthly: 0 };
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

async function main() {
  console.log('Fetching plugins from npm...');

  const [officialResults, communityResults] = await Promise.all([
    searchNpm('@zhin.js', 100),
    searchNpm('zhin.js plugin', 100),
  ]);

  // 合并去重
  const map = new Map();
  for (const obj of [...officialResults, ...communityResults]) {
    map.set(obj.package.name, obj);
  }

  // 收集基础信息
  const basicPlugins = [];
  for (const [, obj] of map) {
    const pkg = obj.package;
    const name = pkg.name;

    // 只保留 @zhin.js/* 或 zhin.js-* 开头的包，排除核心框架包
    if (!name.startsWith('@zhin.js/') && !name.startsWith('zhin.js-')) continue;
    if (CORE_PACKAGES.has(name)) continue;

    const isOfficial = name.startsWith('@zhin.js/');

    // 提取作者
    let author = 'Unknown';
    if (pkg.publisher?.username) author = pkg.publisher.username;
    else if (typeof pkg.author === 'string') author = pkg.author;
    else if (pkg.author?.name) author = pkg.author.name;

    // 显示名
    const displayName = isOfficial
      ? name.replace('@zhin.js/', '').replace('adapter-', '')
      : name.replace('zhin.js-', '');

    const category = getPluginCategory(name, pkg.keywords || []);

    basicPlugins.push({
      name,
      displayName,
      description: pkg.description || '',
      author,
      isOfficial,
      category,
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

  // 组装最终数据
  const plugins = details.map(({ detail, downloads, ...base }) => ({
    ...base,
    downloads: downloads || { weekly: 0, monthly: 0 },
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

main().catch(err => {
  console.error('Failed to update plugins:', err);
  process.exit(1);
});
