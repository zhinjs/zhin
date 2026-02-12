#!/usr/bin/env node

/**
 * 从 npm registry 获取 Zhin.js 生态插件数据
 * 输出到 docs/public/plugins.json
 *
 * 用法: node scripts/update-plugins.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../docs/public/plugins.json');

// ---- 分类判断 ----

function getPluginCategory(name, keywords = []) {
  const lowerName = name.toLowerCase();
  const lowerKw = keywords.map(k => k.toLowerCase());
  const cats = [];

  if (lowerName.includes('adapter') || lowerKw.some(k => k.includes('adapter'))) {
    cats.push('adapter');
  }
  if (lowerKw.some(k => k.includes('service')) || lowerName.includes('service')) {
    cats.push('service');
  }
  if (lowerKw.some(k => k.includes('ai')) || lowerName.includes('ai')) {
    cats.push('ai');
  }
  if (lowerKw.some(k => k.includes('game'))) {
    cats.push('game');
  }
  if (lowerKw.some(k => k.includes('util'))) {
    cats.push('util');
  }
  if (
    lowerName.includes('core') ||
    lowerName.includes('cli') ||
    lowerName.includes('schema') ||
    lowerKw.some(k => k.includes('framework'))
  ) {
    cats.push('framework');
  }

  return cats;
}

// ---- npm 搜索 ----

async function searchNpm(query, size = 100) {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${size}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`npm search failed for "${query}": ${res.status}`);
  const data = await res.json();
  return data.objects || [];
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

  const plugins = [];

  for (const [, obj] of map) {
    const pkg = obj.package;
    const name = pkg.name;

    // 只保留 @zhin.js/* 或 zhin.js-* 开头的包
    if (!name.startsWith('@zhin.js/') && !name.startsWith('zhin.js-')) continue;

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

    plugins.push({
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

  // 排序：官方优先，再按名称字母序
  plugins.sort((a, b) => {
    if (a.isOfficial && !b.isOfficial) return -1;
    if (!a.isOfficial && b.isOfficial) return 1;
    return a.name.localeCompare(b.name);
  });

  // 统计
  const stats = {
    total: plugins.length,
    official: plugins.filter(p => p.isOfficial).length,
    adapters: plugins.filter(p => p.category.includes('adapter')).length,
    community: plugins.filter(p => !p.isOfficial).length,
  };

  const output = { plugins, stats, updatedAt: new Date().toISOString() };

  // 确保输出目录存在
  const outDir = dirname(OUTPUT_PATH);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Done. ${stats.total} plugins written to ${OUTPUT_PATH}`);
  console.log(`  official: ${stats.official}, adapters: ${stats.adapters}, community: ${stats.community}`);
}

main().catch(err => {
  console.error('Failed to update plugins:', err);
  process.exit(1);
});
