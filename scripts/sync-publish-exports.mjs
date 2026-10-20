#!/usr/bin/env node
/**
 * Keep `publishConfig.exports` in sync with `exports` minus the `development`
 * condition for every publishable workspace package.
 *
 * Why: workspace packages expose `"development": "./src/*.ts"` so Vitest, Vite
 * and tsx resolve TypeScript sources inside this monorepo. `src/` is not in the
 * npm tarball, so publishing that condition breaks every consumer whose
 * tooling enables `development` (Vitest 4 does by default). pnpm — and
 * therefore `changeset publish` — replaces `exports` with
 * `publishConfig.exports` in the packed package.json, so the published
 * manifest only exposes files that ship, while the repo keeps source-level dev.
 *
 * Usage:
 *   node scripts/sync-publish-exports.mjs          # write publishConfig.exports
 *   node scripts/sync-publish-exports.mjs --check  # CI: fail when out of sync
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkspaceGraph } from './lib/workspace-graph.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Source-only export conditions that must never reach a published manifest. */
export const SOURCE_ONLY_CONDITIONS = Object.freeze(['development']);

/**
 * Recursively drop source-only conditions from an `exports` value.
 * @param {unknown} value
 * @returns {unknown}
 */
export function stripSourceConditions(value) {
  if (Array.isArray(value)) return value.map(stripSourceConditions);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SOURCE_ONLY_CONDITIONS.includes(key)) continue;
    out[key] = stripSourceConditions(child);
  }
  return out;
}

/** @param {unknown} value */
export function hasSourceConditions(value) {
  if (Array.isArray(value)) return value.some(hasSourceConditions);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) => SOURCE_ONLY_CONDITIONS.includes(key) || hasSourceConditions(child),
  );
}

/**
 * Collect every file target referenced by an `exports` value.
 * @param {unknown} value
 * @returns {string[]}
 */
export function exportTargets(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(exportTargets);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(exportTargets);
}

/**
 * Return the manifest with `publishConfig.exports` aligned, or the same object
 * when nothing needs to change.
 * @param {Record<string, any>} manifest
 */
export function withPublishExports(manifest) {
  if (manifest.private === true) return manifest;
  const current = manifest.publishConfig?.exports;
  if (!hasSourceConditions(manifest.exports)) {
    if (current === undefined) return manifest;
    const { exports: _drop, ...rest } = manifest.publishConfig;
    return { ...manifest, publishConfig: rest };
  }
  const expected = stripSourceConditions(manifest.exports);
  if (JSON.stringify(current) === JSON.stringify(expected)) return manifest;
  return {
    ...manifest,
    publishConfig: { ...(manifest.publishConfig ?? {}), exports: expected },
  };
}

export function publishablePackageFiles() {
  return [...readWorkspaceGraph().values()]
    .map((entry) => path.join(repoRoot, entry.dir, 'package.json'))
    .filter((file) => JSON.parse(fs.readFileSync(file, 'utf8')).private !== true)
    .sort();
}

function main() {
  const check = process.argv.includes('--check');
  const drift = [];
  for (const file of publishablePackageFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const manifest = JSON.parse(text);
    const next = withPublishExports(manifest);
    if (next === manifest) continue;
    drift.push(path.relative(repoRoot, file));
    if (!check) fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  }
  if (check && drift.length > 0) {
    console.error(
      'publishConfig.exports is out of sync with exports (the published manifest must not expose the "development" condition):',
    );
    for (const file of drift) console.error(`  - ${file}`);
    console.error('Run: node scripts/sync-publish-exports.mjs');
    process.exit(1);
  }
  console.log(
    check
      ? 'publishConfig.exports in sync for all publishable packages'
      : `publishConfig.exports updated in ${drift.length} package(s)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
