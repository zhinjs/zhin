#!/usr/bin/env node
/**
 * 由各 workspace `package.json` 生成 docs/contributing/publishing.md 末尾的「包清单」。
 * 每个非 private 包都要在 npmjs.com 配置可信发布者；新包漏在清单外，维护者首次发包后
 * 就容易漏配，下一次 `pnpm pub` 才以 ENEEDAUTH / 404 暴露。
 *
 * 用法:
 *   node scripts/sync-publishing-manifest.mjs          # 重写清单
 *   node scripts/sync-publishing-manifest.mjs --check  # CI：清单与 workspace 不一致则失败
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docPath = path.join(repoRoot, 'docs/contributing/publishing.md');
const MANIFEST_HEADING = '## 包清单';

/** Workspace package patterns from pnpm-workspace.yaml (`dir/*` or an exact directory). */
export function readWorkspacePatterns(root = repoRoot) {
  const text = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  const patterns = [];
  let inPackages = false;
  for (const line of text.split('\n')) {
    if (/^packages:\s*$/.test(line)) { inPackages = true; continue; }
    if (inPackages) {
      const match = line.match(/^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/);
      if (match) { patterns.push(match[1]); continue; }
      if (/^\S/.test(line)) break;
    }
  }
  return patterns;
}

/** Every non-private workspace package, grouped the way the manifest lists them. */
export function collectPublicPackages(root = repoRoot) {
  const packages = [];
  for (const pattern of readWorkspacePatterns(root)) {
    const wildcard = pattern.endsWith('/*');
    const base = wildcard ? pattern.slice(0, -2) : pattern;
    const dirs = wildcard
      ? fs.readdirSync(path.join(root, base), { withFileTypes: true })
        .filter((entry) => entry.isDirectory()).map((entry) => `${base}/${entry.name}`)
      : [base];
    for (const dir of dirs) {
      const manifest = path.join(root, dir, 'package.json');
      if (!fs.existsSync(manifest)) continue;
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (pkg.private || !pkg.name || !pkg.version) continue;
      packages.push({ name: pkg.name, dir, group: wildcard ? `${base}/` : base });
    }
  }
  const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return packages.sort((a, b) => byCodepoint(a.group, b.group) || byCodepoint(a.dir, b.dir));
}

export function renderManifest(packages) {
  const lines = [
    MANIFEST_HEADING,
    '',
    `以下 ${packages.length} 个非 private 包都需要配置可信发布者（由 \`pnpm sync:publishing-manifest\` 从各 \`package.json\` 生成；CI 以 \`pnpm check:publishing-manifest\` 校验，新增或转为 public 的包须先同步本清单）。`,
  ];
  let group;
  for (const pkg of packages) {
    if (pkg.group !== group) {
      group = pkg.group;
      const count = packages.filter((item) => item.group === group).length;
      lines.push('', `### \`${group}\`（${count}）`, '');
    }
    lines.push(`- [ ] \`${pkg.name}\` — \`${pkg.dir}\``);
  }
  return `${lines.join('\n')}\n`;
}

export function syncManifest(doc, packages) {
  const start = doc.indexOf(`\n${MANIFEST_HEADING}\n`);
  if (start < 0) throw new Error(`${MANIFEST_HEADING} not found in docs/contributing/publishing.md`);
  const rest = doc.slice(start + 1 + MANIFEST_HEADING.length);
  const next = rest.search(/\n## /);
  const tail = next < 0 ? '' : rest.slice(next + 1);
  return `${doc.slice(0, start + 1)}${renderManifest(packages)}${tail ? `\n${tail}` : ''}`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const doc = fs.readFileSync(docPath, 'utf8');
  const next = syncManifest(doc, collectPublicPackages());
  if (process.argv.includes('--check')) {
    if (next !== doc) {
      console.error('docs/contributing/publishing.md 包清单与 workspace 非 private 包不一致。');
      console.error('运行 `pnpm sync:publishing-manifest` 后提交。');
      process.exit(1);
    }
    console.log(`Publishing manifest check passed (${collectPublicPackages().length} packages).`);
  } else if (next !== doc) {
    fs.writeFileSync(docPath, next);
    console.log('Updated docs/contributing/publishing.md 包清单.');
  } else {
    console.log('Publishing manifest already in sync.');
  }
}
