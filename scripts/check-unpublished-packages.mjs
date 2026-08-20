#!/usr/bin/env node
/**
 * 检测 workspace 中尚未出现在 npm registry 的可发布包。
 *
 * npm 可信发布 / OIDC 要求包名已存在；新包必须由维护者用 token **手动首次发布**，
 * 之后才可走 changesets `pnpm pub`。本脚本只检测与提示，不再代发。
 *
 * 用法：
 *   node scripts/check-unpublished-packages.mjs
 *   pnpm check:unpublished
 *
 * 退出码：
 *   0 — 全部可发布包已在 npm 上
 *   1 — 存在未首次发包的包（或查询失败）
 */

import { execSync } from 'node:child_process';
import { relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function getWorkspacePackages() {
  const raw = execSync('pnpm -r ls --json --depth -1', {
    encoding: 'utf-8',
    cwd: ROOT,
  });
  const pkgs = JSON.parse(raw);
  return pkgs.filter((p) => !p.private && p.name && p.version && p.path);
}

async function existsOnNpm(name) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`npm view ${name} failed: HTTP ${res.status}`);
}

function rel(pkgPath) {
  return relative(ROOT, pkgPath).replaceAll('\\', '/') || '.';
}

async function main() {
  console.log('Scanning publishable workspace packages…');
  const packages = getWorkspacePackages();
  console.log(`  ${packages.length} non-private package(s)`);

  console.log('Checking npm registry…');
  const results = await Promise.all(
    packages.map(async (pkg) => {
      try {
        return { ...pkg, exists: await existsOnNpm(pkg.name), error: null };
      } catch (error) {
        return {
          ...pkg,
          exists: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const queryFailed = results.filter((p) => p.error);
  if (queryFailed.length > 0) {
    console.error('\nFailed to query npm for:');
    for (const p of queryFailed) {
      console.error(`  - ${p.name}: ${p.error}`);
    }
    process.exit(1);
  }

  const unpublished = results.filter((p) => !p.exists);
  if (unpublished.length === 0) {
    console.log('All publishable packages already exist on npm.');
    return;
  }

  console.error('');
  console.error('='.repeat(72));
  console.error(
    `Found ${unpublished.length} package(s) that need a MANUAL first publish.`,
  );
  console.error(
    'npm no longer allows automated first publish in this CI flow;',
  );
  console.error(
    'create each package once with a trusted token, then re-run publish.',
  );
  console.error('='.repeat(72));
  console.error('');
  console.error('Packages:');
  for (const p of unpublished) {
    console.error(`  - ${p.name}@${p.version}  (${rel(p.path)})`);
  }

  console.error('');
  console.error('How to first-publish (maintainer machine or one-off CI job):');
  console.error('  1. Ensure packages are built:  pnpm build');
  console.error('  2. Login / set token:          npm login   # or NODE_AUTH_TOKEN=…');
  console.error('  3. Publish each package once:');
  for (const p of unpublished) {
    console.error(
      `       (cd ${rel(p.path)} && npm publish --access public)`,
    );
  }
  console.error('  4. Re-run "Build and Publish" (push to main or workflow_dispatch).');
  console.error('');
  console.error(
    'After the names exist on npm, subsequent versions go through changesets (pnpm pub).',
  );
  console.error('='.repeat(72));

  // GitHub Actions annotations for the Summary / Checks UI
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const p of unpublished) {
      console.error(
        `::error title=First publish required::${p.name}@${p.version} is not on npm — publish once manually then re-run this workflow.`,
      );
    }
  }

  process.exit(1);
}

main().catch((error) => {
  console.error('check-unpublished-packages failed:', error);
  process.exit(1);
});
