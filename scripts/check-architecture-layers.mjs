#!/usr/bin/env node
/**
 * Harness: 检查架构层级依赖是否正确
 *
 * 依赖层级的 SSOT：docs/concepts/architecture.md。
 * 本门禁把零依赖契约、Feature 机制、IM/AI 组装与 composition root
 * 映射为实际可检查的包依赖。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseImports } from './lib/parse-imports.mjs';
import { findAgentManifestWorkroomViolations, findAgentWorkroomViolations } from './lib/agent-workroom-boundary.mjs';
import { readWorkspaceGraph } from './lib/workspace-graph.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// 定义层级和允许的依赖关系
// basic/ 内部的包可以相互导入
// 注意（ADR 0054 §0）：Zhin 实例的装配根是 zhin.js 的 `src/instance/`（`zhin.js/instance`
// 装配 ImRuntime / Agent Host / 运行时侧 Console 后端），因此只有这个目录能导入
// packages/im 各层、协议 Host 与 Console 栈。@zhin.js/cli 与 @zhin.js/gateway 不得导入
// IM 层（只允许 plugin-runtime 契约与 runtime 的配置 / 项目文件工具）；CLI 需要实例代码时
// 按项目根解析 `zhin.js/instance`，不静态导入。
// basic/{logger,schema,database} 仍保持最底层约束。
// Plugin Runtime 新层（约定式插件运行时迁移引入）：
// plugin-runtime（契约/宿主 token，零 zhin 依赖）→ feature-kit（feature provider 基座）
// → 9 个 provider 包（adapter/command/component/middleware/handler/tool/skill/agent-feature/mcp-feature）
// → runtime（RootHost 装配 + isolate / config-file）。
// packages/host/http-contract 是协议 Host 的最小端口（路由 + body），零业务依赖。
// packages/host/http 是具体 HTTP / WebSocket Host，仅依赖 basic + plugin-runtime。
/** `@zhin.js/cli` and `@zhin.js/gateway`: no IM layer (ADR 0054 §0). */
export const managementLayerAllowed = Object.freeze([
  // basic/* except basic/cli: the gateway must not import the CLI (the CLI depends on it).
  'basic/logger',
  'basic/schema',
  'basic/database',
  'basic/schedule',
  'packages/im/plugin-runtime',
  'packages/im/runtime',
  'packages/host/http',
  'packages/host/http-contract',
]);
function managementAllowed(extra) {
  return [...managementLayerAllowed, ...extra];
}
const providerLayerAllowed = [
  'basic',
  'packages/im/im-contract',
  'packages/im/plugin-runtime',
  'packages/im/permission',
  'packages/im/feature-kit',
];
export const layers = {
  // Console wire SSOT must remain zero-dependency so browsers, both Hosts and
  // external Console builds can share it without pulling runtime packages.
  'packages/console/protocol': { level: 0, allowedImports: [] },
  'packages/host/http-contract': { level: 0, allowedImports: [] },
  'basic/cli': { level: 0, allowedImports: managementAllowed(['basic', 'packages/host/gateway', 'packages/console']) },
  'basic': { level: 0, allowedImports: ['basic'] },
  'packages/im/jsx': { level: 0, allowedImports: ['packages/im/im-contract'] },
  'packages/toolkit/tailwind': { level: 0, allowedImports: ['packages/im/jsx'] },
  'packages/toolkit/components': { level: 0, allowedImports: ['packages/im/jsx'] },
  'packages/im/im-contract': { level: 0, allowedImports: [] },
  'packages/im/plugin-runtime': { level: 1, allowedImports: ['basic'] },
  'packages/im/permission': { level: 1, allowedImports: ['basic', 'packages/im/plugin-runtime'] },
  'packages/im/feature-kit': { level: 1, allowedImports: ['basic', 'packages/im/plugin-runtime'] },
  'packages/im/adapter': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/command': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/component': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/middleware': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/handler': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/tool': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/skill': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/agent-feature': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/mcp-feature': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/prompt-section': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/schedule-feature': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/runtime': { level: 1, allowedImports: [...providerLayerAllowed, 'packages/im/adapter', 'packages/im/command', 'packages/im/component', 'packages/im/middleware', 'packages/im/handler', 'packages/im/tool', 'packages/im/skill', 'packages/im/agent-feature', 'packages/im/mcp-feature', 'packages/im/prompt-section', 'packages/im/schedule-feature'] },
  // ADR 0054: the management gateway never loads zhin.js, IM layers or plugin code.
  'packages/host/gateway': { level: 1, allowedImports: managementAllowed(['packages/console/protocol']) },
  'packages/host/http': { level: 1, allowedImports: ['basic', 'packages/im/plugin-runtime', 'packages/console/protocol', 'packages/host/http-contract'] },
  'packages/im/kernel': { level: 1, allowedImports: ['basic'] },
  'packages/im/ai': { level: 2, allowedImports: ['basic', 'packages/im/kernel', 'packages/im/plugin-runtime'] },
  'packages/im/harness': { level: 3, allowedImports: ['basic', 'packages/im/im-contract', 'packages/im/kernel', 'packages/im/core'] },
  'packages/im/core': { level: 3, allowedImports: ['packages/im/feature-kit', 'packages/im/jsx', 'basic', 'packages/im/im-contract', 'packages/im/harness', 'packages/im/kernel', 'packages/im/ai', 'packages/im/plugin-runtime', 'packages/im/permission', 'packages/im/adapter', 'packages/im/command', 'packages/im/component', 'packages/im/middleware', 'packages/im/handler'] },
  'packages/im/agent': { level: 4, allowedImports: ['basic', 'packages/im/im-contract', 'packages/im/harness', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/im/plugin-runtime', 'packages/im/permission', 'packages/im/feature-kit', 'packages/im/adapter', 'packages/im/agent-feature', 'packages/im/mcp-feature', 'packages/im/prompt-section', 'packages/im/skill', 'packages/im/tool'] },
  // define-plugin.ts 是 @zhin.js/plugin-runtime 的门面 re-export（zhin.js/plugin-runtime 子路径），允许。
  // ADR 0044 §3: shared OneBot-family raw event → canonical side event mapping; adapters depend on it, core never does.
  'packages/im/adapter-onebot-events': { level: 4, allowedImports: ['basic', 'packages/im/core', 'packages/im/adapter', 'packages/im/im-contract'] },
  // ADR 0054 §0: the instance composition root (moved from basic/cli). The
  // packages/host/gateway edge is temporary (IAM / terminal installers and shared
  // project-file services) until the gateway process owns them (B1.4).
  'packages/im/zhin/src/instance': { level: 6, allowedImports: ['basic', 'packages/im', 'packages/host', 'packages/console', 'packages/toolkit'] },
  'packages/im/zhin': { level: 5, allowedImports: ['packages/im/jsx', 'basic', 'packages/im/harness', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/im/agent', 'packages/im/runtime', 'packages/im/plugin-runtime', 'packages/im/permission', 'packages/im/schedule-feature'] },
  // Protocol Hosts consume only the narrow HTTP route contract; they must not
  // depend on the concrete HTTP Host implementation.
  'packages/host/mcp': { level: 7, allowedImports: ['basic', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/im/tool', 'packages/host/http-contract'] },
  'packages/host/a2a': { level: 7, allowedImports: ['basic', 'packages/im/harness', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/im/agent', 'packages/host/http-contract'] },
  'packages/console/contract': { level: 10, allowedImports: ['basic', 'packages/im/ai', 'packages/console/protocol'] },
  'packages/console/pagemanager': { level: 11, allowedImports: ['basic', 'packages/console/contract', 'packages/im/plugin-runtime', 'packages/im/feature-kit', 'packages/im/runtime'] },
  'packages/console/client': { level: 12, allowedImports: ['basic', 'packages/console/protocol', 'packages/console/contract'] },
};

// 重叠层级（basic/cli ⊂ basic）按最长路径优先解析
const layerPathsBySpecificity = Object.keys(layers).sort((a, b) => b.length - a.length);

// 包名到路径的映射
export const packageNameToPath = {
  '@zhin.js/jsx': 'packages/im/jsx',
  '@zhin.js/tailwind': 'packages/toolkit/tailwind',
  '@zhin.js/components': 'packages/toolkit/components',
  '@zhin.js/logger': 'basic/logger',
  '@zhin.js/schema': 'basic/schema',
  '@zhin.js/database': 'basic/database',
  '@zhin.js/cli': 'basic/cli',
  '@zhin.js/kernel': 'packages/im/kernel',
  '@zhin.js/ai': 'packages/im/ai',
  '@zhin.js/core': 'packages/im/core',
  '@zhin.js/agent': 'packages/im/agent',
  '@zhin.js/adapter-onebot-events': 'packages/im/adapter-onebot-events',
  'zhin.js': 'packages/im/zhin',
  '@zhin.js/host-http': 'packages/host/http',
  '@zhin.js/gateway': 'packages/host/gateway',
  '@zhin.js/speech': 'packages/toolkit/speech',
  '@zhin.js/testing': 'packages/toolkit/testing',
  '@zhin.js/html-renderer': 'packages/toolkit/html-renderer',
  '@zhin.js/host-http-contract': 'packages/host/http-contract',
  '@zhin.js/mcp': 'packages/host/mcp',
  '@zhin.js/a2a': 'packages/host/a2a',
  '@zhin.js/plugin-runtime': 'packages/im/plugin-runtime',
  '@zhin.js/permission': 'packages/im/permission',
  '@zhin.js/harness': 'packages/im/harness',
  '@zhin.js/feature-kit': 'packages/im/feature-kit',
  '@zhin.js/adapter': 'packages/im/adapter',
  '@zhin.js/command': 'packages/im/command',
  '@zhin.js/component': 'packages/im/component',
  '@zhin.js/middleware': 'packages/im/middleware',
  '@zhin.js/handler': 'packages/im/handler',
  '@zhin.js/tool': 'packages/im/tool',
  '@zhin.js/skill': 'packages/im/skill',
  '@zhin.js/agent-feature': 'packages/im/agent-feature',
  '@zhin.js/mcp-feature': 'packages/im/mcp-feature',
  '@zhin.js/prompt-section': 'packages/im/prompt-section',
  '@zhin.js/schedule-feature': 'packages/im/schedule-feature',
  '@zhin.js/runtime': 'packages/im/runtime',
  '@zhin.js/im-contract': 'packages/im/im-contract',
  '@zhin.js/console-protocol': 'packages/console/protocol',
  '@zhin.js/contract': 'packages/console/contract',
  '@zhin.js/pagemanager': 'packages/console/pagemanager',
  '@zhin.js/client': 'packages/console/client',
};

const skipDirNames = new Set(['node_modules', 'lib', 'dist', 'coverage', '.git', 'tests', '__tests__']);

/** @param {string} dir @param {string[]} acc */
function walkTs(dir, acc) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (skipDirNames.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkTs(p, acc);
    else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.test.ts') && !name.endsWith('.spec.ts')) {
      acc.push(p);
    }
  }
}

/**
 * 获取文件所属的层级
 * @param {string} filePath - 文件路径
 * @returns {string|null} - 层级路径或 null
 */
function getLayerForFile(filePath) {
  const relativePath = path.relative(repoRoot, filePath);

  for (const layerPath of layerPathsBySpecificity) {
    if (relativePath.startsWith(layerPath + '/') || relativePath.startsWith(layerPath + '\\')) {
      return layerPath;
    }
  }

  return null;
}

/**
 * 检查导入是否违反层级规则
 * @param {string} sourceLayer - 源文件所属层级
 * @param {string} sourceFile - 源文件路径
 * @param {string} importPath - 导入路径
 * @returns {{ valid: boolean, targetLayer?: string, reason?: string }}
 */
function checkImport(sourceLayer, sourceFile, importPath) {
  // 相对导入总是允许的
  if (importPath.startsWith('.') || importPath.startsWith('/')) {
    return { valid: true };
  }

  // 解析包名
  let packageName = importPath;
  if (importPath.startsWith('@')) {
    // Scoped package: @scope/name
    const parts = importPath.split('/');
    packageName = parts.slice(0, 2).join('/');
  } else {
    // Regular package: name
    packageName = importPath.split('/')[0];
  }

  // 获取目标层级路径
  const targetLayerPath = packageNameToPath[packageName];
  if (!targetLayerPath) {
    // 未知包，允许（可能是外部依赖）
    return { valid: true };
  }

  // 检查是否是同一包内的导入（允许）
  // 例如：@zhin.js/core 内部可以导入 @zhin.js/core
  if (targetLayerPath === sourceLayer) {
    return { valid: true };
  }

  // 检查是否是同一层级内的导入（允许）
  // 例如：basic/cli 可以导入 basic/logger
  if (targetLayerPath.startsWith(sourceLayer + '/') || sourceLayer.startsWith(targetLayerPath + '/')) {
    return { valid: true };
  }

  // 检查是否允许导入（允许导入以允许层级开头的任何路径）
  const allowedImports = layers[sourceLayer].allowedImports;
  const isAllowed = allowedImports.some(allowed =>
    targetLayerPath === allowed || targetLayerPath.startsWith(allowed + '/')
  );

  if (!isAllowed) {
    return {
      valid: false,
      targetLayer: targetLayerPath,
      reason: `Layer "${sourceLayer}" cannot import from "${targetLayerPath}"`,
    };
  }

  return { valid: true };
}

/**
 * Extract bare package name (`@scope/pkg` or `pkg`) from an import specifier,
 * or `null` for relative/absolute/node:/subpath-import (`#...`) specifiers.
 * @param {string} importPath
 * @returns {string | null}
 */
export function extractBarePackageName(importPath) {
  if (
    !importPath
    || importPath.startsWith('.')
    || importPath.startsWith('/')
    || importPath.startsWith('#')
    || importPath.startsWith('node:')
  ) {
    return null;
  }
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return importPath.split('/')[0];
}

/**
 * Check that every workspace package imported in `content` (including `import type`)
 * is declared in `manifest` (`dependencies`, `peerDependencies`, `optionalDependencies`,
 * or `devDependencies`), or is a self-import (`manifest.name`).
 *
 * @param {{
 *   file: string,
 *   content: string,
 *   manifest: Record<string, any>,
 *   manifestPath: string,
 *   workspacePackageNames: ReadonlySet<string>,
 * }} params
 * @returns {Array<{ file: string, import: string, packageName: string, manifestPath: string, reason: string }>}
 */
export function findUndeclaredWorkspaceImports({
  file,
  content,
  manifest,
  manifestPath,
  workspacePackageNames,
}) {
  const declared = new Set([
    ...(typeof manifest.name === 'string' ? [manifest.name] : []),
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
  const violations = [];
  const seen = new Set();
  for (const importPath of parseImports(content, { includeTypeOnly: true })) {
    const pkgName = extractBarePackageName(importPath);
    if (!pkgName || !workspacePackageNames.has(pkgName) || declared.has(pkgName)) continue;
    if (seen.has(pkgName)) continue;
    seen.add(pkgName);
    violations.push({
      file,
      import: importPath,
      packageName: pkgName,
      manifestPath,
      reason: `${manifest.name ?? manifestPath} imports workspace package "${pkgName}" (${importPath}) without declaring it in ${manifestPath}`,
    });
  }
  return violations;
}

/**
 * Manifest-level ADR 0054 rule: `@zhin.js/cli` / `@zhin.js/gateway` must not depend on `zhin.js`
 * or any IM layer (dependencies, peer, optional or dev).
 * @param {Record<string, any>} manifest
 * @param {string} manifestPath
 * @param {string} packageName
 */
export function findManagementManifestViolations(manifest, manifestPath, packageName) {
  const violations = [];
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
    for (const dependency of Object.keys(manifest[section] ?? {})) {
      const target = packageNameToPath[dependency];
      if (!target) continue;
      const allowed = layers[managementLayerKey(packageName)].allowedImports.some(prefix => target === prefix || target.startsWith(`${prefix}/`));
      if (!allowed) {
        violations.push({
          file: manifestPath,
          import: dependency,
          reason: `${packageName} must not depend on IM layers or zhin.js (${section}; ADR 0054 §0)`,
        });
      }
    }
  }
  return violations;
}

function managementLayerKey(packageName) {
  return packageName === '@zhin.js/cli' ? 'basic/cli' : 'packages/host/gateway';
}

function runMain() {
const violations = [];
const seenFiles = new Set();

// 扫描所有源文件（重叠层级只按最具体层级检查一次）
for (const layerPath of layerPathsBySpecificity) {
  const absPath = path.join(repoRoot, layerPath);
  const files = [];
  walkTs(absPath, files);

  for (const file of files) {
    const relativeFilePath = path.relative(repoRoot, file);
    if (seenFiles.has(relativeFilePath)) continue;
    seenFiles.add(relativeFilePath);
    const sourceLayer = getLayerForFile(file) ?? layerPath;
    const content = fs.readFileSync(file, 'utf8');
    const imports = parseImports(content, { includeTypeOnly: true });

    // Protocol Hosts only; the management gateway is a process with its own module state.
    if (sourceLayer.startsWith('packages/host/') && sourceLayer !== 'packages/host/gateway'
      && /^let\s+[A-Za-z_$][\w$]*(?:\s*:[^=;]+)?\s*(?:=|;)/mu.test(content)) {
      violations.push({
        file: relativeFilePath,
        import: 'module-level mutable binding',
        reason: 'Protocol Host runtime state must be owned by a Host instance or registration',
      });
    }

    for (const importPath of imports) {
      const result = checkImport(sourceLayer, relativeFilePath, importPath);
      if (!result.valid) {
        violations.push({
          file: relativeFilePath,
          import: importPath,
          reason: result.reason,
        });
      }
    }
  }
}

// Import scanning cannot see a manifest dependency before source starts using
// it. These wire contracts must remain safe for their independent consumers.
const zeroRuntimeDependencyContracts = [
  {
    directory: 'packages/console/protocol',
    packageName: '@zhin.js/console-protocol',
  },
  {
    directory: 'packages/host/http-contract',
    packageName: '@zhin.js/host-http-contract',
  },
];
for (const contract of zeroRuntimeDependencyContracts) {
  const manifestPath = `${contract.directory}/package.json`;
  const manifest = JSON.parse(fs.readFileSync(
    path.join(repoRoot, manifestPath),
    'utf8',
  ));
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(manifest[section] ?? {})) {
      violations.push({
        file: manifestPath,
        import: dependency,
        reason: `${contract.packageName} must remain zero-runtime-dependency (${section})`,
      });
    }
  }
}

// ADR 0054 §0: the CLI and the gateway take no IM-layer dependency in any manifest
// section, so a dynamic import cannot hide one either.
for (const managed of [
  { directory: 'basic/cli', packageName: '@zhin.js/cli' },
  { directory: 'packages/host/gateway', packageName: '@zhin.js/gateway' },
]) {
  const manifestPath = `${managed.directory}/package.json`;
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, manifestPath), 'utf8'));
  violations.push(...findManagementManifestViolations(manifest, manifestPath, managed.packageName));
}

{
  const manifestPath = 'packages/im/agent/package.json';
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, manifestPath), 'utf8'));
  violations.push(...findAgentManifestWorkroomViolations(manifest, manifestPath));
}

if (violations.length) {
  console.error('Harness architecture layer check: FAILED\n');
  console.error('The following imports violate the architecture layer rules:\n');

  for (const v of violations) {
    console.error(`  ${v.file}:`);
    console.error(`    Import: ${v.import}`);
    console.error(`    Reason: ${v.reason}\n`);
  }

  console.error('Architecture layers (bottom → top):');
  console.error('  1. basic/ (logger, schema, database, cli)');
  console.error('  2. packages/im/kernel (no IM concepts)');
  console.error('  3. packages/im/ai (providers, agents, memory)');
  console.error('  4. packages/im/harness & packages/im/core (Plugin, Adapter, Endpoint, Command, Venue, Harness)');
  console.error('  5. packages/im/agent (ZhinAgent, security policies)');
  console.error('  6. packages/im/zhin (main entry)');
  console.error('  (parallel) packages/console/{contract,pagemanager,client}\n');

  console.error('Each layer can only import from layers below it.');
  console.error('See CLAUDE.md for details.\n');

  process.exit(1);
}

console.log('Harness architecture layer check: OK (no layer violations found).');

// ── Assistant 反向依赖：低层不得 import @zhin.js/agent / assistant/ ──
const assistantForbiddenLayers = ['packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/im/harness'];
const assistantImportRe = /@zhin\.js\/agent(?:\/|$)/;
const assistantPathRe = /\/assistant\//;
const reverseViolations = [];

for (const layerPath of assistantForbiddenLayers) {
  const absPath = path.join(repoRoot, layerPath);
  const files = [];
  walkTs(absPath, files);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const importPath of parseImports(content, { includeTypeOnly: true })) {
      if (assistantImportRe.test(importPath) || assistantPathRe.test(importPath)) {
        reverseViolations.push({
          file: path.relative(repoRoot, file),
          import: importPath,
          reason: `Layer "${layerPath}" must not import Assistant Runtime (${importPath})`,
        });
      }
    }
  }
}

// agent 层不得依赖 host 包（Host API 应单向依赖 agent）
const agentRoot = path.join(repoRoot, 'packages/im/agent/src');
const agentFiles = [];
walkTs(agentRoot, agentFiles);
const hostImportRe = /@zhin\.js\/host-|packages\/host\//;

for (const file of agentFiles) {
  const content = fs.readFileSync(file, 'utf8');
  for (const importPath of parseImports(content, { includeTypeOnly: true })) {
    if (hostImportRe.test(importPath)) {
      reverseViolations.push({
        file: path.relative(repoRoot, file),
        import: importPath,
        reason: `packages/im/agent must not import host packages (${importPath})`,
      });
    }
  }
}

if (reverseViolations.length) {
  console.error('\nHarness assistant reverse-dependency check: FAILED\n');
  for (const v of reverseViolations) {
    console.error(`  ${v.file}:`);
    console.error(`    Import: ${v.import}`);
    console.error(`    Reason: ${v.reason}\n`);
  }
  process.exit(1);
}

console.log('Harness assistant reverse-dependency check: OK.');

// Agent is generic. No Agent source file (barrels included) may reference the
// removed Workroom package or any Workroom-owned directory.
const agentSrcRoot = path.join(repoRoot, 'packages/im/agent/src');
const agentReexportViolations = [];
const agentSrcFiles = [];
walkTs(agentSrcRoot, agentSrcFiles);
for (const file of agentSrcFiles) {
  const content = fs.readFileSync(file, 'utf8');
  agentReexportViolations.push(...findAgentWorkroomViolations({ file: path.relative(repoRoot, file), content }));
}

if (agentReexportViolations.length) {
  console.error('\nHarness Agent -> Workroom reference check: FAILED\n');
  for (const violation of agentReexportViolations) {
    console.error(`  ${violation.file}:`);
    console.error(`    Import: ${violation.import}`);
    console.error(`    Reason: ${violation.reason}\n`);
  }
  process.exit(1);
}

console.log('Harness Agent -> Workroom reference check: OK.');

// Undeclared workspace dependency check: every workspace package imported in a
// package's src/ (or client/) directory must be declared in its package.json so
// isolated per-package tsc builds never fail with TS2307 in CI.
const workspaceGraph = readWorkspaceGraph();
const workspacePackageNames = new Set(workspaceGraph.keys());
const undeclaredViolations = [];

for (const node of workspaceGraph.values()) {
  if (node.dir.startsWith('examples/')) continue;
  const manifestPath = `${node.dir}/package.json`;
  const absManifestPath = path.join(repoRoot, manifestPath);
  if (!fs.existsSync(absManifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(absManifestPath, 'utf8'));
  const files = [];
  walkTs(path.join(repoRoot, node.dir, 'src'), files);
  walkTs(path.join(repoRoot, node.dir, 'client'), files);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    undeclaredViolations.push(...findUndeclaredWorkspaceImports({
      file: path.relative(repoRoot, file),
      content,
      manifest,
      manifestPath,
      workspacePackageNames,
    }));
  }
}

if (undeclaredViolations.length) {
  console.error('\nHarness undeclared workspace dependency check: FAILED\n');
  for (const violation of undeclaredViolations) {
    console.error(`  ${violation.file}:`);
    console.error(`    Import: ${violation.import}`);
    console.error(`    Reason: ${violation.reason}\n`);
  }
  process.exit(1);
}

console.log('Harness undeclared workspace dependency check: OK.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMain();
}
