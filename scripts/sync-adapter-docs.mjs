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
      const management = m.management?.length ? m.management.join(', ') : '—';
      return `| ${m.label} | \`${m.packageName}\` | ${management} | [${m.label}](/adapters/${slug}) |`;
    })
    .join('\n');
  return `| 适配器 | 包名 | Endpoint 管理能力 | 文档 |
|--------|------|-------------------|------|
${rows}
`;
}

function buildIndexMarkdown() {
  return `# 平台适配器

适配器把外部平台接入 Zhin 的统一消息与 Endpoint 模型。先按部署条件选择接入方式，再检查能力和维护档位；不要只按平台名称选包。

## 先做选择

| 你的条件 | 优先方向 | 代表适配器 |
| --- | --- | --- |
| 先验证业务，不接真实账号 | 本地 Sandbox | Sandbox |
| 平台提供官方 Bot / App API | 官方连接 | QQ 官方、Discord、Telegram、Slack、钉钉、飞书、微信公众号 |
| 已部署协议桥或网关 | 网关连接 | OneBot v11；NapCat、Milky、OneBot v12 等需自行验收 |
| 事件天然来自协作系统 | 工作项连接 | GitHub（Experimental） |
| 入口不是即时聊天 | 非聊天消息源 | Email（Experimental） |

选择前确认五件事：凭据由谁保管、平台如何投递入站事件、是否需要撤回或成员管理、部署环境能否接收回调，以及该档位是否满足你的发布标准。

## 推荐接入流程

1. 用 \`npx zhin setup --adapters\` 选择并生成适配器配置。
2. 执行 \`pnpm install\` 与 \`pnpm dev\`，先让 Sandbox 黄金路径通过。
3. 在 Console 的“会话与频道”确认入站，在“运行时能力”核对 Endpoint 操作，在“日志”完成故障定位。
4. 把真实平台加入同一业务链；命令、组件和中间件不应读取平台私有 SDK。

每个 \`@zhin.js/adapter-*\` 包都有独立文档页，并与包内 \`README.md\` 同步。下方档位与能力表是发布事实，不是推荐榜单。

> 框架级概念（多平台同跑、消息流、端点生命周期）见 [核心概念](/concepts/architecture) 与 [端点生命周期](/authoring/endpoint-lifecycle)。
>
> **档位 SSOT**：[\`scripts/adapter-meta.mjs\`](https://github.com/zhinjs/zhin/blob/main/scripts/adapter-meta.mjs)（与 docs/snippets/platform-tiers.md 同源）。

## 档位

| 档位 | 含义 |
|------|------|
| **Stable** | 与 \`pnpm check:stable\`、[minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) 一致 |
| **Platform Stable** | 主流 IM；须满足 ADR 0015 D3 并进入 \`check:stable\` Platform 批（**当前无**） |
| **Advanced** | [test-bot](https://github.com/zhinjs/zhin/tree/main/examples/test-bot) 维护者厨房水槽（非用户模板）常用；有 integration 测试但不在 Stable smoke |
| **Experimental** | 可用性因部署差异大，需自行验证；**≠ 无测试**，= 无全量 CI/实机承诺 |

## Stable

${buildTierTable('Stable')}
## Platform Stable

${buildTierTable('PlatformStable')}
## Advanced

${buildTierTable('Advanced')}
## Experimental

${buildTierTable('Experimental')}
## 统一消息操作能力

消息发送由所有声明 **outbound** 的 Endpoint 支持；消息级扩展操作通过统一
**EndpointControl** 暴露，并按每个具体 Endpoint 精确声明。Core 不探测平台 SDK 私有方法。

| 操作 | 已接入平台 |
|------|------------|
| recall | Discord、ICQQ、KOOK、飞书、Milky、NapCat、OneBot 11/12、QQ 官方、Satori、Slack、Telegram、企业微信 |
| edit | Slack |
| reaction | Discord Gateway、ICQQ、Slack |
| typing | 微信 iLink |

同一适配器不同接入模式可以具有不同能力。例如 Discord Gateway 支持 reaction，
Interactions 模式只声明 recall；Host/Console 可从 Endpoint row 的 **operations** 字段读取
当前模式的准确能力集。

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
    '| slug | tier | label | package | Endpoint management |',
    '|------|------|-------|---------|---------------------|',
  ];
  for (const slug of Object.keys(ADAPTER_META).sort((a, b) => {
    const ta = TIER_ORDER[ADAPTER_META[a].tier];
    const tb = TIER_ORDER[ADAPTER_META[b].tier];
    if (ta !== tb) return ta - tb;
    return a.localeCompare(b);
  })) {
    const m = ADAPTER_META[slug];
    lines.push(`| ${slug} | ${tierDisplayName(m.tier)} | ${m.label} | \`${m.packageName}\` | ${m.management?.join(', ') ?? '—'} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/** @type {string[]} */
const stale = [];
/** @type {string[]} */
const updated = [];
/** @type {string[]} */
const operabilityIssues = [];

for (const slug of listAdapterSlugs()) {
  if (!ADAPTER_META[slug]) {
    stale.push(`${slug} (missing from scripts/adapter-meta.mjs)`);
  }
  const readmePath = path.join(adaptersRoot, slug, 'README.md');
  const pkgPath = path.join(adaptersRoot, slug, 'package.json');
  const outPath = path.join(docsRoot, `${slug}.md`);

  const readmeBody = fs.readFileSync(readmePath, 'utf8');
  const requiredSections = [
    ['prerequisites', /^## (前置条件|Prerequisites)$/mu],
    ['configuration', /^## (最小配置(?:（[^\n]+）)?|配置(?:（[^\n]+）)?|Minimal Configuration|Minimal config)$/mu],
    ['troubleshooting', /^## (故障排查|Troubleshooting)$/mu],
  ];
  for (const [section, pattern] of requiredSections) {
    if (!pattern.test(readmeBody)) operabilityIssues.push(`${slug} (missing ${section})`);
  }
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

if (operabilityIssues.length > 0) {
  console.error('Adapter README operability contract failed:\n');
  for (const issue of operabilityIssues) console.error(`  - ${issue}`);
  console.error('\nEach adapter needs prerequisites, minimal configuration, and troubleshooting.');
  process.exit(1);
}

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
