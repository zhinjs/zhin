#!/usr/bin/env node
/**
 * 综合 harness 检查脚本
 * 运行所有 harness 检查并生成报告
 *
 * 并行执行独立检查，按 CPU 核心数限制并发。
 * 设 HARNESS_SEQUENTIAL=1 回退到串行模式（调试用）。
 */
import { exec } from 'node:child_process';
import { availableParallelism } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const skipUnitTests = process.env.HARNESS_SKIP_TEST === '1';
const sequential = process.env.HARNESS_SEQUENTIAL === '1';
const concurrency = sequential ? 1 : Math.min(availableParallelism(), 4);

const HEAVY_CHECKS = new Set([
  'Unit Tests', 'Install Size (IM core)', 'Lint', 'Type Check',
  'Plugin Runtime Migration Verify', 'L4-CI (deterministic subset)', 'Stable Smoke',
]);

const checks = [
  {
    name: 'Unit Tests',
    command: 'pnpm test',
    description: '全量 Vitest（pnpm test）',
  },
  {
    name: 'Install Size (IM core)',
    command: 'pnpm check:install-size',
    description: 'zhin.js production node_modules ≤10MB（ADR 0019）',
  },
  {
    name: 'Lint',
    command: 'pnpm lint:ci',
    description: 'ESLint（.ts/.tsx）',
    retries: 1,
  },
  {
    name: 'Type Check',
    command: 'pnpm type-check',
    description: 'tsc --noEmit（tsconfig.typecheck.json）',
  },
  {
    name: 'Plugin Runtime Migration Verify',
    command: 'pnpm check:plugin-runtime-migration-verify',
    description: '离线 E2E：cutover 后构建，公开包 tarball 含 JS entry 与 manifest 契约',
  },
  {
    name: 'L4-CI (deterministic subset)',
    command: 'pnpm check:l4-ci',
    description: 'PR 门禁 L4 子集；全量 check:l4 见 nightly-smoke',
  },
  {
    name: 'Stable Smoke',
    command: 'pnpm check:stable',
    description: 'Stable 路径 smoke（Sandbox + Agent 核心单测 + minimal-bot 契约）',
  },
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
    name: 'Publish Repository',
    command: 'pnpm check:publish-repository',
    description: '可发布包 repository.url 须匹配 github.com/zhinjs/zhin（npm provenance）',
  },
  {
    name: 'Agent Tool Schema',
    command: 'pnpm check:agent-tool-schema',
    description: 'agent/tools inputSchema 与 defineAgentTool/execute 类型字段一致',
  },
  {
    name: 'No Package-Root skills/',
    command: 'pnpm check:no-package-skills',
    description: '插件包禁止顶层 skills/，须用 agent/skills/*.md',
  },
  {
    name: 'Architecture Layers',
    command: 'pnpm check:architecture',
    description: '检查架构层级依赖是否正确',
  },
  {
    name: 'Adapter Endpoint Boundaries',
    command: 'pnpm check:adapter-endpoint-boundaries',
    description: '检查 Adapter definition 与 Endpoint instance 职责不混淆',
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
    name: 'Operability Docs',
    command: 'pnpm check:operability-docs',
    description: '检查适配器、Console 与插件交付文档是否形成可验收闭环',
  },
  {
    name: 'Generated API Docs',
    command: 'pnpm check:api-docs',
    description: '检查公开入口、源码注释链接与 API Reference 生成契约',
  },
  {
    name: 'Generated Config Reference',
    command: 'pnpm check:config-reference',
    description: '检查配置字段参考与 Runtime 源码、插件 JSON Schema 无漂移',
  },
  {
    name: 'Source-owned Config Enums',
    command: 'pnpm check:config-enums',
    description: '检查源码既定配置枚举在 Runtime/插件 Schema、生成参考和叙事文档间无漂移',
  },
  {
    name: 'Troubleshooting Center',
    command: 'pnpm check:troubleshooting',
    description: '检查结构化故障目录与中英文排查页面无漂移',
  },
  {
    name: 'Deployment Templates',
    command: 'pnpm check:deployment-templates',
    description: '校验 Compose、systemd、Kubernetes 模板与中英文下载入口',
  },
  {
    name: 'Platform Tiers SSOT',
    command: 'pnpm check:platform-tiers-ssot',
    description: '能力分档/适配器索引与 scripts/adapter-meta.mjs 一致',
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
    name: 'Plugin Runtime API',
    command: 'pnpm check:plugin-runtime-api',
    description: '检查约定式插件运行时 API surface 快照',
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
    name: 'Plugin Runtime Migration Readiness',
    command: 'pnpm check:plugin-runtime-migration-readiness',
    description: '已迁移插件必须保持 native manifest，且函数体不得调用 legacy usePlugin/getPlugin',
  },
  {
    name: 'Feature Peer Deps',
    command: 'pnpm check:feature-peers',
    description: 'zhin.features 引用的包须出现在 peerDependencies（runtime 1.0.12+）',
  },
  {
    name: 'Rich Segment Adapters',
    command: 'pnpm check:rich-segments',
    description: '各 adapter 在 adapters/*.ts 声明 segments.outboundMedia（或豁免）',
  },
  {
    name: 'AI Outbound Adapters',
    command: 'pnpm check:ai-outbound',
    description: '声明 aiOutboundExtensions 的 adapter 含契约测试',
  },
  {
    name: 'Interactive Segments',
    command: 'pnpm check:interactive-segments',
    description: '各 adapter 在 adapters/*.ts 声明 segments.interactive（或豁免）',
  },
  {
    name: 'Segment Adapters',
    command: 'pnpm check:segments',
    description: '各 adapter 在 adapters/*.ts 声明 defineAdapter segments（或豁免）',
  },
  {
    name: 'Provider Gateway',
    command: 'pnpm check:provider-gateway',
    description: '已知 LLM 网关 sdk/contextWindow 预设与 OpenCode 等契约',
  },
  {
    name: 'Workroom SSOT',
    command: 'pnpm check:workroom-ssot',
    description: 'Workroom 状态须经 Journal + CAS Kernel，禁止并行可变权威',
  },
  {
    name: 'A2A Mesh',
    command: 'pnpm check:a2a-mesh',
    description: '禁止残留 MCP Agent Mesh v1 符号',
  },
].filter((c) => !(skipUnitTests && c.name === 'Unit Tests'));

function executeCheck(check) {
  return new Promise((resolve) => {
    exec(check.command, {
      cwd: repoRoot,
      maxBuffer: 32 * 1024 * 1024,
    }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  });
}

async function runCheck(check) {
  const start = performance.now();
  const attempts = 1 + (check.retries ?? 0);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { error, stdout, stderr } = await executeCheck(check);
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);
    if (!error) {
      console.log(`  ✓ ${check.name} (${elapsed}s)`);
      return { name: check.name, status: 'PASSED', elapsed };
    }

    if (attempt < attempts) {
      console.log(`  ↻ ${check.name} failed; retrying once`);
      continue;
    }

    const output = [stdout, stderr]
      .map((value) => value.trim())
      .filter(Boolean)
      .join('\n');
    const details = [
      output,
      error.message,
      `exit code: ${String(error.code ?? 'unknown')}`,
      `signal: ${String(error.signal ?? 'none')}`,
    ].filter(Boolean).join('\n');
    console.log(`  ✗ ${check.name} FAILED (${elapsed}s)`);
    return { name: check.name, status: 'FAILED', elapsed, error: details };
  }

  throw new Error(`unreachable check state: ${check.name}`);
}

async function runPool(items, limit) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const check = items[idx++];
      results.push(await runCheck(check));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function main() {
  if (skipUnitTests) {
    console.log('HARNESS_SKIP_TEST=1 — skipping Unit Tests (expect a separate coverage/test job)\n');
  }

  const heavy = checks.filter((c) => HEAVY_CHECKS.has(c.name));
  const light = checks.filter((c) => !HEAVY_CHECKS.has(c.name));

  const mode = sequential ? 'sequential' : `parallel (concurrency=${concurrency})`;
  console.log(`Running ${checks.length} harness checks [${mode}]...`);
  console.log(`  Phase 1: ${light.length} lightweight checks`);
  console.log(`  Phase 2: ${heavy.length} heavyweight checks\n`);

  const totalStart = performance.now();

  console.log('── Phase 1: lightweight ──');
  const lightResults = await runPool(light, concurrency);

  console.log('\n── Phase 2: heavyweight ──');
  const heavyResults = await runPool(heavy, Math.min(concurrency, 2));

  const results = [...lightResults, ...heavyResults];
  const totalElapsed = ((performance.now() - totalStart) / 1000).toFixed(1);
  const cpuTotal = results.reduce((s, r) => s + parseFloat(r.elapsed), 0).toFixed(1);
  const allPassed = results.every((r) => r.status === 'PASSED');

  console.log('\n' + '='.repeat(60));
  console.log(`Harness Check Summary (${totalElapsed}s wall, ${cpuTotal}s CPU)`);
  console.log('='.repeat(60));

  for (const result of results) {
    const status = result.status === 'PASSED' ? '✓' : '✗';
    console.log(`${status} ${result.name}: ${result.status} (${result.elapsed}s)`);
  }

  console.log('='.repeat(60));

  if (!allPassed) {
    console.error('\nSome harness checks failed. See above for details.\n');
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
}

main();
