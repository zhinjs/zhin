#!/usr/bin/env node
/**
 * 将 plugins/adapters 各包 README.md 同步到 docs/adapters/{slug}.md
 *
 * 用法:
 *   node scripts/sync-adapter-docs.mjs          # 写入
 *   node scripts/sync-adapter-docs.mjs --check  # CI：README 变更但未同步则失败
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const adaptersRoot = path.join(repoRoot, 'plugins/adapters');
const docsRoot = path.join(repoRoot, 'docs/adapters');

const checkOnly = process.argv.includes('--check');

/** @type {Record<string, { tier: 'Stable' | 'Advanced' | 'Experimental', label: string }>} */
const ADAPTER_META = {
  sandbox: { tier: 'Stable', label: 'Sandbox' },
  icqq: { tier: 'Advanced', label: 'ICQQ (QQ)' },
  qq: { tier: 'Advanced', label: 'QQ 官方' },
  napcat: { tier: 'Experimental', label: 'NapCat' },
  onebot11: { tier: 'Advanced', label: 'OneBot v11' },
  onebot12: { tier: 'Experimental', label: 'OneBot v12' },
  milky: { tier: 'Experimental', label: 'Milky' },
  kook: { tier: 'Advanced', label: 'KOOK' },
  discord: { tier: 'Advanced', label: 'Discord' },
  telegram: { tier: 'Advanced', label: 'Telegram' },
  slack: { tier: 'Advanced', label: 'Slack' },
  dingtalk: { tier: 'Advanced', label: '钉钉' },
  lark: { tier: 'Advanced', label: '飞书' },
  'wechat-mp': { tier: 'Advanced', label: '微信公众号' },
  email: { tier: 'Experimental', label: 'Email' },
  github: { tier: 'Experimental', label: 'GitHub' },
  satori: { tier: 'Experimental', label: 'Satori' },
};

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
  const meta = ADAPTER_META[slug] ?? { tier: 'Advanced', label: slug };
  const hash = crypto.createHash('sha256').update(readmeBody).digest('hex').slice(0, 16);
  const transformed = transformLinks(readmeBody.trim(), slug);
  const sourcePath = `plugins/adapters/${slug}/README.md`;
  const githubSource = `https://github.com/zhinjs/zhin/tree/main/${sourcePath}`;

  return `---
title: "${packageName}"
package: "${packageName}"
tier: ${meta.tier}
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
      const tierOrder = { Stable: 0, Advanced: 1, Experimental: 2 };
      const ta = tierOrder[ADAPTER_META[a]?.tier ?? 'Advanced'];
      const tb = tierOrder[ADAPTER_META[b]?.tier ?? 'Advanced'];
      if (ta !== tb) return ta - tb;
      return (ADAPTER_META[a]?.label ?? a).localeCompare(ADAPTER_META[b]?.label ?? b, 'zh');
    });
}

/** @type {string[]} */
const stale = [];
/** @type {string[]} */
const updated = [];

for (const slug of listAdapterSlugs()) {
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

if (checkOnly) {
  if (stale.length > 0) {
    console.error('Adapter docs out of sync with plugin READMEs:\n');
    for (const s of stale) console.error(`  - ${s}`);
    console.error('\nRun: pnpm sync:adapter-docs');
    process.exit(1);
  }
  console.log(`Adapter doc sync check passed (${listAdapterSlugs().length} adapters).`);
} else {
  console.log(
    updated.length > 0
      ? `Synced adapter docs: ${updated.join(', ')}`
      : `Adapter docs already up to date (${listAdapterSlugs().length} adapters).`,
  );
}
