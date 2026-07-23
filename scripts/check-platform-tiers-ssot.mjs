#!/usr/bin/env node
/**
 * 校验能力分档叙事页引用的平台档位与 scripts/adapter-meta.mjs SSOT 一致。
 * docs/adapters/index.md 与 docs/snippets/platform-tiers.md 由 sync-adapter-docs 生成，亦在此交叉校验。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTER_META, tierDisplayName, slugsForTier } from './adapter-meta.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const capabilityPath = path.join(repoRoot, 'docs/essentials/capability-tiers.md');
const snippetPath = path.join(repoRoot, 'docs/snippets/platform-tiers.md');
const indexPath = path.join(repoRoot, 'docs/adapters/index.md');

const errors = [];
const endpointManagementCapabilities = new Set([
  'listFriends', 'listGroups', 'listChannels', 'listGroupMembers',
  'approveRequest', 'rejectRequest', 'kickGroupMember', 'muteGroupMember',
  'setGroupAdmin', 'deleteFriend',
]);

for (const [slug, meta] of Object.entries(ADAPTER_META)) {
  for (const capability of meta.management ?? []) {
    if (!endpointManagementCapabilities.has(capability)) {
      errors.push(`adapter-meta.mjs ${slug} has unknown Endpoint management capability: ${capability}`);
    }
  }
}

const capability = fs.readFileSync(capabilityPath, 'utf8');

// Must not claim Platform Stable adapters that aren't in SSOT
const platformStableSlugs = new Set(slugsForTier('PlatformStable'));

// Legacy pattern: adapter names in "Platform Stable" section as /adapters/ links
const platformSection = capability.match(
  /## Platform Stable[\s\S]*?(?=\n## )/,
);
if (platformSection) {
  const links = [...platformSection[0].matchAll(/\/adapters\/([a-z0-9-]+)/g)].map((m) => m[1]);
  for (const slug of links) {
    if (ADAPTER_META[slug]?.tier !== 'PlatformStable' && ADAPTER_META[slug]?.tier !== 'Stable') {
      // Allow linking Sandbox under Stable Core elsewhere; in Platform Stable section only PlatformStable
      if (platformStableSlugs.size === 0) {
        errors.push(
          `capability-tiers.md Platform Stable section links /adapters/${slug} but SSOT has zero Platform Stable adapters`,
        );
      } else if (!platformStableSlugs.has(slug)) {
        errors.push(`capability-tiers.md claims Platform Stable for ${slug}, SSOT tier=${ADAPTER_META[slug]?.tier}`);
      }
    }
  }
}

if (/Platform Stable 共 \d+/.test(capability)) {
  errors.push('capability-tiers.md still claims a fixed Platform Stable count; use SSOT wording');
}

if (/MCP Mesh/.test(capability)) {
  errors.push('capability-tiers.md still mentions MCP Mesh; use A2A Agent Mesh');
}

// Catch stale "Platform Stable" claims outside empty SSOT (marketing)
for (const rel of ['docs/marketing/juejin-first-run-outline.md']) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) continue;
  const text = fs.readFileSync(abs, 'utf8');
  if (platformStableSlugs.size === 0 && /支持[^。\n]*（Platform Stable）/.test(text)) {
    errors.push(`${rel}: claims platforms are Platform Stable while SSOT is empty`);
  }
}

if (!fs.existsSync(snippetPath)) {
  errors.push('docs/snippets/platform-tiers.md missing — run pnpm sync:adapter-docs');
} else {
  const snippet = fs.readFileSync(snippetPath, 'utf8');
  for (const [slug, meta] of Object.entries(ADAPTER_META)) {
    const row = `| ${slug} | ${tierDisplayName(meta.tier)} |`;
    if (!snippet.includes(`| ${slug} |`)) {
      errors.push(`platform-tiers.md missing slug ${slug}`);
    } else if (!snippet.includes(row)) {
      errors.push(`platform-tiers.md tier mismatch for ${slug}`);
    }
  }
}

const index = fs.readFileSync(indexPath, 'utf8');
if (!index.includes('scripts/adapter-meta.mjs')) {
  errors.push('docs/adapters/index.md must cite adapter-meta.mjs as SSOT');
}
for (const slug of slugsForTier('Stable')) {
  if (!index.includes(`/adapters/${slug}`)) {
    errors.push(`adapters/index.md missing Stable adapter ${slug}`);
  }
}

if (errors.length) {
  console.error('check-platform-tiers-ssot failed:\n');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `Platform tiers SSOT check passed (${Object.keys(ADAPTER_META).length} adapters; Platform Stable=${platformStableSlugs.size}).`,
);
