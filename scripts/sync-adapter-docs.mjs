#!/usr/bin/env node
/**
 * 将 plugins/adapters 各包 README.md 同步到 docs/adapters/{slug}.md，
 * 并按 scripts/adapter-meta.mjs SSOT 重写 docs/adapters/index.md 档位表。
 *
 * 用法:
 *   node scripts/sync-adapter-docs.mjs          # 写入
 *   node scripts/sync-adapter-docs.mjs --check  # CI：README 变更但未同步则失败
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADAPTER_META,
  TIER_ORDER,
  tierDisplayName,
  tierForFrontmatter,
  slugsForTier,
} from './adapter-meta.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const adaptersRoot = path.join(repoRoot, 'plugins/adapters');
const docsRoot = path.join(repoRoot, 'docs/adapters');
const indexPath = path.join(docsRoot, 'index.md');
const snippetPath = path.join(repoRoot, 'docs/snippets/platform-tiers.md');

const checkOnly = process.argv.includes('--check');

/**
 * @param {string} body
 * @param {string} slug
 */
function transformLinks(body, slug) {
  let s = body;
  s = s.replace(
    /\]\((?:\.\.\/)+examples\/minimal-bot\/?\)/g,
    '](/getting-started/)',
  );
  s = s.replace(
    /\]\((?:\.\.\/)+examples\/([^)]+)\)/g,
    '](https://github.com/zhinjs/zhin/tree/main/examples/$1)',
  );
  s = s.replace(
    /\]\((?:\.\.\/)+plugins\/adapters\/([^)]+)\)/g,
    '](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/$1)',
  );
  s = s.replace(
    /\]\(\.\/([^)]+\.md)\)/g,
    `](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/${slug}/$1)`,
  );
  s = s.replace(
    /\]\(\.\.\/([^)]+\.md)\)/g,
    (_, rel) => {
      const normalized = path.posix.normalize(path.posix.join('plugins/adapters', slug, rel));
      return `](https://github.com/zhinjs/zhin/tree/main/${normalized})`;
    },
  );
  return s;
}

/**
 * @param {string} slug
 * @param {string} packageName
 * @param {string} readmeBody
 */
function buildDoc(slug, packageName, readmeBody) {
  const meta = ADAPTER_META[slug] ?? { tier: 'Advanced', label: slug, packageName };
  const hash = crypto.createHash('sha256').update(readmeBody).digest('hex').slice(0, 16);
  const transformed = transformLinks(readmeBody.trim(), slug);
  const sourcePath = `plugins/adapters/${slug}/README.md`;
  const githubSource = `https://github.com/zhinjs/zhin/tree/main/${sourcePath}`;
  const tier = tierForFrontmatter(meta.tier);

  return `---
title: "${packageName}"
package: "${packageName}"
tier: ${tier}
---

::: info 文档同步
本页由 [\`${sourcePath}\`](${githubSource}) 自动生成。请修改包内 README 后运行 \`pnpm sync:adapter-docs\`。
:::

<!-- sync-adapter-docs:sha256=${hash} -->

${transformed}
`;
}

/**
 * @returns {string[]}
 */
function listAdapterSlugs() {
  return fs
    .readdirSync(adaptersRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(adaptersRoot, d.name, 'README.md')))
    .map((d) => d.name)
    .sort((a, b) => {
      const ta = TIER_ORDER[ADAPTER_META[a]?.tier ?? 'Advanced'] ?? 99;
      const tb = TIER_ORDER[ADAPTER_META[b]?.tier ?? 'Advanced'] ?? 99;
      if (ta !== tb) return ta - tb;
      return (ADAPTER_META[a]?.label ?? a).localeCompare(ADAPTER_META[b]?.label ?? b, 'zh');
    });
}

/**
 * @param {import('./adapter-meta.mjs').AdapterTier} tier
 */
function buildTierTable(tier) {
  const slugs = slugsForTier(tier);
  if (slugs.length === 0) {
    return '_（当前无）_\n';
  }
  const rows = slugs
    .map((slug) => {
      const m = ADAPTER_META[slug];
      return `| ${m.label} | \`${m.packageName}\` | [${m.label}](/adapters/${slug}) |`;
    })
    .join('\n');
  return `| 适配器 | 包名 | 文档 |
|--------|------|------|
${rows}
`;
}

function buildIndexMarkdown() {
  return `# 平台适配器

适配器连接 IM / 聊天平台与 Zhin.js 核心。每个 \`@zhin.js/adapter-*\` 包有**独立文档页**，内容与包内 \`README.md\` 保持同步（\`pnpm sync:adapter-docs\`）。

> 框架级概念（多平台同跑、群管工具自动注册等）见 [适配器概览](/essentials/adapters)。
>
> **档位 SSOT**：[\`scripts/adapter-meta.mjs\`](https://github.com/zhinjs/zhin/blob/main/scripts/adapter-meta.mjs)（本页与 [能力分档](/essentials/capability-tiers) 同源）。升档条件见 [ADR 0015](/adr/0015-capability-tier-model)。

## 档位

| 档位 | 含义 |
|------|------|
| **Stable** | 与 \`pnpm check:stable\`、[minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) 一致 |
| **Platform Stable** | 主流 IM；须满足 ADR 0015 D3 并进入 \`check:stable\` Platform 批（**当前无**） |
| **Advanced** | [test-bot](https://github.com/zhinjs/zhin/tree/main/examples/test-bot) 厨房水槽常用；有 integration 测试但不在 Stable smoke |
| **Experimental** | 可用性因部署差异大，需自行验证；**≠ 无测试**，= 无全量 CI/实机承诺 |

## Stable

${buildTierTable('Stable')}
## Platform Stable

${buildTierTable('PlatformStable')}
## Advanced

${buildTierTable('Advanced')}
## Experimental

${buildTierTable('Experimental')}
## 维护说明

- **单一来源（档位）**：\`scripts/adapter-meta.mjs\`
- **单一来源（正文）**：\`plugins/adapters/<name>/README.md\`
- **同步命令**：仓库根目录 \`pnpm sync:adapter-docs\`
- **CI 检查**：\`pnpm check:adapter-docs\`、\`pnpm check:platform-tiers-ssot\`

源码索引：[plugins/adapters/README.md](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/README.md)
`;
}

/** Markdown table region for docs/snippets/platform-tiers.md */
function buildPlatformTiersSnippet() {
  const lines = [
    '---',
    'sidebar: false',
    '---',
    '',
    '<!-- Generated by sync-adapter-docs from scripts/adapter-meta.mjs — do not hand-edit -->',
    '',
    '| slug | tier | label | package |',
    '|------|------|-------|---------|',
  ];
  for (const slug of Object.keys(ADAPTER_META).sort((a, b) => {
    const ta = TIER_ORDER[ADAPTER_META[a].tier];
    const tb = TIER_ORDER[ADAPTER_META[b].tier];
    if (ta !== tb) return ta - tb;
    return a.localeCompare(b);
  })) {
    const m = ADAPTER_META[slug];
    lines.push(`| ${slug} | ${tierDisplayName(m.tier)} | ${m.label} | \`${m.packageName}\` |`);
  }
  lines.push('');
  return lines.join('\n');
}

/** @type {string[]} */
const stale = [];
/** @type {string[]} */
const updated = [];

for (const slug of listAdapterSlugs()) {
  if (!ADAPTER_META[slug]) {
    stale.push(`${slug} (missing from scripts/adapter-meta.mjs)`);
  }
  const readmePath = path.join(adaptersRoot, slug, 'README.md');
  const pkgPath = path.join(adaptersRoot, slug, 'package.json');
  const outPath = path.join(docsRoot, `${slug}.md`);

  const readmeBody = fs.readFileSync(readmePath, 'utf8');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const next = buildDoc(slug, pkg.name, readmeBody);

  if (checkOnly) {
    if (!fs.existsSync(outPath)) {
      stale.push(`${slug}.md (missing)`);
      continue;
    }
    const existing = fs.readFileSync(outPath, 'utf8');
    const expectedHash = crypto.createHash('sha256').update(readmeBody).digest('hex').slice(0, 16);
    const match = existing.match(/<!-- sync-adapter-docs:sha256=([a-f0-9]+) -->/);
    if (!match || match[1] !== expectedHash) {
      stale.push(slug);
    }
    continue;
  }

  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, 'utf8') !== next) {
    fs.mkdirSync(docsRoot, { recursive: true });
    fs.writeFileSync(outPath, next);
    updated.push(slug);
  }
}

const nextIndex = buildIndexMarkdown();
const nextSnippet = buildPlatformTiersSnippet();

if (checkOnly) {
  if (!fs.existsSync(indexPath) || fs.readFileSync(indexPath, 'utf8') !== nextIndex) {
    stale.push('index.md (tier tables out of sync with adapter-meta.mjs)');
  }
  if (!fs.existsSync(snippetPath) || fs.readFileSync(snippetPath, 'utf8') !== nextSnippet) {
    stale.push('docs/snippets/platform-tiers.md (out of sync)');
  }
  for (const slug of Object.keys(ADAPTER_META)) {
    const dir = path.join(adaptersRoot, slug);
    if (!fs.existsSync(path.join(dir, 'README.md'))) {
      stale.push(`${slug} (in ADAPTER_META but no plugins/adapters/${slug}/README.md)`);
    }
  }
  if (stale.length > 0) {
    console.error('Adapter docs out of sync with plugin READMEs / adapter-meta:\n');
    for (const s of stale) console.error(`  - ${s}`);
    console.error('\nRun: pnpm sync:adapter-docs');
    process.exit(1);
  }
  console.log(`Adapter doc sync check passed (${listAdapterSlugs().length} adapters).`);
} else {
  if (!fs.existsSync(indexPath) || fs.readFileSync(indexPath, 'utf8') !== nextIndex) {
    fs.writeFileSync(indexPath, nextIndex);
    updated.push('index');
  }
  fs.mkdirSync(path.dirname(snippetPath), { recursive: true });
  if (!fs.existsSync(snippetPath) || fs.readFileSync(snippetPath, 'utf8') !== nextSnippet) {
    fs.writeFileSync(snippetPath, nextSnippet);
    updated.push('platform-tiers.md');
  }
  console.log(
    updated.length > 0
      ? `Synced adapter docs: ${updated.join(', ')}`
      : `Adapter docs already up to date (${listAdapterSlugs().length} adapters).`,
  );
}
