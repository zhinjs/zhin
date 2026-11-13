#!/usr/bin/env node
/**
 * 发布前检查：本地可发布包的版本号已在 npm 上、且高于 npm 的 `latest`，说明这个号被别的
 * 版本线（旧架构）占用了，`changeset publish` 会静默跳过它。见 registry-version-collisions.mjs。
 *
 *   node scripts/check-version-collisions.mjs   # pnpm check:version-collisions
 *
 * 退出码：0 无撞号；1 有撞号或查询 npm 失败。
 */
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLocalCollisions, readRegistryVersions } from './registry-version-collisions.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = JSON.parse(execSync('pnpm -r ls --json --depth -1', { encoding: 'utf8', cwd: root }))
  .filter((pkg) => !pkg.private && pkg.name && pkg.version)
  .map((pkg) => ({ name: pkg.name, version: pkg.version }));

try {
  const collisions = await findLocalCollisions(packages, (name) => readRegistryVersions(name));
  if (collisions.length > 0) {
    console.error('These versions are already on npm from another release line; changeset publish would skip them:');
    for (const hit of collisions) {
      console.error(`- ${hit.name}@${hit.version} (npm latest ${hit.latest}; first free minor ${hit.suggestion})`);
    }
    process.exit(1);
  }
  console.log(`Version collision check passed (${packages.length} publishable packages).`);
} catch (error) {
  console.error(`Version collision check could not read the npm registry: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
