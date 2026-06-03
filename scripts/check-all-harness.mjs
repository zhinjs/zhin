#!/usr/bin/env node
/**
 * 综合 harness 检查脚本
 * 运行所有 harness 检查并生成报告
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const checks = [
  {
    name: 'IM Send Path',
    command: 'pnpm check:harness-paths',
    description: '检查是否绕过 Adapter.sendMessage 链路',
  },
  {
    name: 'No Koa Import',
    command: 'pnpm check:no-koa',
    description: '检查插件是否直接 import koa',
  },
  {
    name: 'Production Config',
    command: 'pnpm check:prod',
    description: '检查生产环境配置（无调试代码）',
  },
  {
    name: 'Plugin Spec',
    command: 'pnpm check:plugin',
    description: '检查插件是否符合标准规范',
  },
  {
    name: 'Architecture Layers',
    command: 'pnpm check:architecture',
    description: '检查架构层级依赖是否正确',
  },
  {
    name: 'Adapter Docs Sync',
    command: 'pnpm check:adapter-docs',
    description: '检查平台适配器文档是否与 plugins/adapters README 同步',
  },
  {
    name: 'Doc Links',
    command: 'pnpm check:doc-links',
    description: '检查文档相对链接是否断裂',
  },
  {
    name: 'Doc Orphans',
    command: 'pnpm check:doc-orphans',
    description: '检查站点 Markdown 是否在侧栏或 allowlist',
  },
  {
    name: 'README Exports',
    command: 'pnpm check:readme-exports',
    description: '检查 README import 与包导出一致',
  },
  {
    name: 'Config Docs',
    command: 'pnpm check:config-docs',
    description: '配置文档与 DEFAULT_CONFIG 关键字段对齐',
  },
  {
    name: 'Stable Smoke',
    command: 'pnpm check:stable',
    description: 'Stable 路径 smoke（Sandbox + Agent 核心单测 + minimal-bot 契约）',
  },
  {
    name: 'usePlugin Top-Level',
    command: 'pnpm check:use-plugin-top-level',
    description: '插件 usePlugin() 须在模块顶层',
  },
];

console.log('Running all harness checks...\n');

const results = [];
let allPassed = true;

for (const check of checks) {
  console.log(`Running: ${check.name}`);
  console.log(`  ${check.description}`);

  try {
    execSync(check.command, {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    results.push({ name: check.name, status: 'PASSED' });
    console.log('  ✓ PASSED\n');
  } catch (error) {
    results.push({
      name: check.name,
      status: 'FAILED',
      error: error.stderr?.toString() || error.message,
    });
    console.log('  ✗ FAILED\n');
    allPassed = false;
  }
}

console.log('='.repeat(60));
console.log('Harness Check Summary');
console.log('='.repeat(60));

for (const result of results) {
  const status = result.status === 'PASSED' ? '✓' : '✗';
  console.log(`${status} ${result.name}: ${result.status}`);
}

console.log('='.repeat(60));

if (!allPassed) {
  console.error('\nSome harness checks failed. See above for details.\n');

  // Print detailed errors for failed checks
  console.error('Detailed errors:');
  for (const result of results) {
    if (result.status === 'FAILED') {
      console.error(`\n${result.name}:`);
      console.error(result.error);
    }
  }

  process.exit(1);
}

console.log('\nAll harness checks passed! ✓\n');
