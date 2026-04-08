#!/usr/bin/env node

/**
 * 自动检测并首次发布尚未在 npm 上的 workspace 包
 *
 * 解决的问题：
 *   npm OIDC 可信发布要求包已存在于 registry。新包必须先用 token 发布一次，
 *   之后才能走 OIDC / changeset 流程。
 *
 * 用法：
 *   NODE_AUTH_TOKEN=<npm-token> node scripts/init-new-packages.mjs
 *
 * 行为：
 *   1. 读取 pnpm workspace 所有非 private 包
 *   2. 并发查询 npm registry，找出尚未发布的包
 *   3. 对这些包执行 `npm publish --access public --provenance`
 *   4. 输出结果汇总
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── 1. 获取所有 workspace 包 ────────────────────────────────────────────────

function getWorkspacePackages() {
  const raw = execSync('pnpm -r ls --json --depth -1', { encoding: 'utf-8' });
  const pkgs = JSON.parse(raw);
  // 过滤：非 private、有 name、有 version
  return pkgs.filter(p => !p.private && p.name && p.version);
}

// ── 2. 检查包是否已在 npm 上 ────────────────────────────────────────────────

async function existsOnNpm(name) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      headers: { 'Accept': 'application/json' },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

// ── 3. 发布：临时修改根 .npmrc 注入认证 ─────────────────────────────────────

let rootNpmrcBackup = null;
let rootNpmrcSetup = false;

function setupRootNpmrc(token) {
  if (rootNpmrcSetup) return;
  const rootNpmrc = resolve(ROOT, '.npmrc');
  rootNpmrcBackup = existsSync(rootNpmrc) ? readFileSync(rootNpmrc, 'utf-8') : null;
  const existing = rootNpmrcBackup || '';
  // 追加 npmjs.org 认证（如果不存在）
  if (!existing.includes('//registry.npmjs.org/:_authToken')) {
    writeFileSync(rootNpmrc, existing + `\n//registry.npmjs.org/:_authToken=${token}\n`);
  }
  rootNpmrcSetup = true;
}

function restoreRootNpmrc() {
  if (!rootNpmrcSetup) return;
  const rootNpmrc = resolve(ROOT, '.npmrc');
  if (rootNpmrcBackup !== null) {
    writeFileSync(rootNpmrc, rootNpmrcBackup);
  }
  rootNpmrcSetup = false;
}

function publishPackage(pkg) {
  const args = ['npm', 'publish', '--access', 'public', '--registry', 'https://registry.npmjs.org/'];
  // CI 环境下加 --provenance（需要 id-token 权限）
  if (process.env.CI) {
    args.push('--provenance');
  }
  // 支持 OTP（本地 2FA 场景）
  if (process.env.OTP) {
    args.push('--otp', process.env.OTP);
  }

  try {
    const output = execSync(args.join(' '), {
      cwd: pkg.path,
      stdio: 'pipe',
      encoding: 'utf-8',
      env: { ...process.env },
    });
    return { name: pkg.name, success: true };
  } catch (e) {
    const fullError = [e.stderr, e.stdout, e.message].filter(Boolean).join('\n');
    return { name: pkg.name, success: false, error: fullError };
  }
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 扫描 workspace 包...');
  const packages = getWorkspacePackages();
  console.log(`   共 ${packages.length} 个非 private 包`);

  // 并发检查
  console.log('🌐 检查 npm registry...');
  const checks = await Promise.all(
    packages.map(async (pkg) => ({
      ...pkg,
      exists: await existsOnNpm(pkg.name),
    }))
  );

  const newPackages = checks.filter(p => !p.exists);

  if (newPackages.length === 0) {
    console.log('✅ 所有包已在 npm 上，无需初始化发布');
    return;
  }

  console.log(`\n📦 发现 ${newPackages.length} 个新包需要首次发布：`);
  newPackages.forEach(p => console.log(`   - ${p.name}@${p.version} (${p.path})`));

  // 检查 auth
  if (!process.env.NODE_AUTH_TOKEN && !process.env.NPM_TOKEN) {
    console.error('\n❌ 需要 NODE_AUTH_TOKEN 或 NPM_TOKEN 环境变量来发布新包');
    console.error('   CI 中: 确保 secrets.PERSONAL_TOKEN 可用');
    console.error('   本地: NODE_AUTH_TOKEN=npm_xxx node scripts/init-new-packages.mjs');
    process.exit(1);
  }

  // 如果设置了 NPM_TOKEN 但没有 NODE_AUTH_TOKEN，映射一下
  if (!process.env.NODE_AUTH_TOKEN && process.env.NPM_TOKEN) {
    process.env.NODE_AUTH_TOKEN = process.env.NPM_TOKEN;
  }

  const token = process.env.NODE_AUTH_TOKEN;

  // 检查 lib/ 是否存在（需要先构建）
  const unbuilt = newPackages.filter(p => {
    try {
      execSync(`test -d "${p.path}/lib"`, { stdio: 'pipe' });
      return false;
    } catch {
      return true;
    }
  });
  if (unbuilt.length > 0) {
    console.error(`\n❌ 以下包未构建（缺少 lib/ 目录），请先运行 pnpm build：`);
    unbuilt.forEach(p => console.error(`   - ${p.name}`));
    process.exit(1);
  }

  // 逐个发布（先注入根 .npmrc 认证，完成后恢复）
  console.log('\n🚀 开始首次发布...\n');
  setupRootNpmrc(token);
  const results = [];
  try {
    for (const pkg of newPackages) {
      process.stdout.write(`   发布 ${pkg.name}@${pkg.version} ... `);
      const result = publishPackage(pkg);
      results.push(result);
      if (result.success) {
        console.log('✅');
      } else {
        console.log('❌');
        // 过滤掉 npm notice 行，只显示实际错误
        const errorLines = (result.error || '')
          .split('\n')
          .filter(l => !l.startsWith('npm notice') && l.trim())
          .join('\n');
        if (errorLines) console.error(`      ${errorLines.replace(/\n/g, '\n      ')}`);
      }
    }
  } finally {
    restoreRootNpmrc();
  }

  // 汇总
  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\n📊 结果: ${succeeded.length} 成功, ${failed.length} 失败`);
  if (failed.length > 0) {
    console.error('失败的包：');
    failed.forEach(r => console.error(`   - ${r.name}: ${r.error?.split('\n')[0]}`));
    process.exit(1);
  }

  console.log('\n✅ 所有新包已发布！后续版本更新将由 changesets 自动处理。');
}

main().catch(e => {
  console.error('脚本执行失败:', e);
  process.exit(1);
});
