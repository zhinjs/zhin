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
    name: 'Plugin Agent Publish',
    command: 'pnpm check:plugin-agent-publish',
    description: '带 agent/ 的插件 npm 发布清单（files、prepublishOnly、peer 依赖）',
  },
  {
    name: 'Architecture Layers',
    command: 'pnpm check:architecture',
    description: '检查架构层级依赖是否正确',
  },
  {
    name: 'IM Session SSOT',
    command: 'pnpm check:im-session-ssot',
    description: '检查 IM 场景/session 身份解析是否使用 core SSOT',
  },
  {
    name: 'getModel Import Disambiguation',
    command: 'pnpm check:get-model-imports',
    description: 'agent/zhin 运行时代码须使用 getLlmTransportModel 而非歧义 getModel',
  },
  {
    name: 'Legacy AI Exports',
    command: 'pnpm check:legacy-ai-exports',
    description: '禁止 @zhin.js/ai 再导出 SessionManager / resolveIMSessionId* / convertLegacy* / getModel',
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
    name: 'Install Tiers SSOT',
    command: 'pnpm check:install-tiers-ssot',
    description: 'README Install tiers 表与 docs/snippets/install-tiers.md 一致',
  },
  {
    name: 'Dependency Policy',
    command: 'pnpm check:dependency-policy',
    description: '用户项目脚手架依赖默认写 latest',
  },
  {
    name: 'API Surface',
    command: 'pnpm check:api-surface',
    description: '检查 public API surface 快照',
  },
  {
    name: 'Doc Orphans',
    command: 'pnpm check:doc-orphans',
    description: '检查站点 Markdown 是否在侧栏或 allowlist',
  },
  {
    name: 'ADR Manifest',
    command: 'pnpm check:adr-manifest',
    description: '检查 ADR README 与 VitePress 侧栏覆盖所有 ADR',
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
  {
    name: 'getPlugin Runtime',
    command: 'pnpm check:get-plugin-runtime',
    description: '插件目录禁止在 middleware/action 等运行时回调内 getPlugin()',
  },
  {
    name: 'Install Size (IM core)',
    command: 'pnpm check:install-size',
    description: 'zhin.js production node_modules ≤10MB（ADR 0019）',
  },
  {
    name: 'Rich Segment Adapters',
    command: 'pnpm check:rich-segments',
    description: '各 adapter 声明 outboundRichSegmentPolicy 与契约测试',
  },
  {
    name: 'AI Outbound Adapters',
    command: 'pnpm check:ai-outbound',
    description: '声明 aiOutboundExtensions 的 adapter 含契约测试',
  },
  {
    name: 'Interactive Segments',
    command: 'pnpm check:interactive-segments',
    description: '各 adapter 声明 interactivePolicy 与契约测试',
  },
  {
    name: 'Segment Adapters',
    command: 'pnpm check:segments',
    description: '各 adapter segment-mapper 契约（sandbox 必须达标）',
  },
  {
    name: 'Provider Gateway',
    command: 'pnpm check:provider-gateway',
    description: '已知 LLM 网关 sdk/contextWindow 预设与 OpenCode 等契约',
  },
  {
    name: 'Orchestration SSOT',
    command: 'pnpm check:orchestration-ssot',
    description: '编排任务状态须经 OrchestrationKernel，禁止 repositoryHandle 直写',
  },
  {
    name: 'A2A Mesh',
    command: 'pnpm check:a2a-mesh',
    description: '禁止残留 MCP Agent Mesh v1 符号',
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
