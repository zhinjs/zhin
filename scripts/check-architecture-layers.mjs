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
import { findForbiddenRelativeImports } from './lib/find-forbidden-imports.mjs';
import { findAgentManifestWorkroomViolations, findAgentWorkroomViolations } from './lib/agent-workroom-boundary.mjs';
import { isForbiddenDomainSpecifier } from './lib/workroom-specifier.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// 定义层级和允许的依赖关系
// basic/ 内部的包可以相互导入
// 注意：basic/cli 是 Plugin Runtime 的 composition root（`zhin runtime start`
// 直接装配 ImRuntime / Agent Host / Console Host，见
// docs/architecture/target-implementation/in-place-migration.md「start、migrate、
// scaffold | @zhin.js/cli」），因此它必须能导入 packages/im 各层。
// 该例外只适用于 basic/cli，basic/{logger,schema,database} 仍保持最底层约束。
// Plugin Runtime 新层（约定式插件运行时迁移引入）：
// plugin-runtime（契约/宿主 token，零 zhin 依赖）→ feature-kit（feature provider 基座）
// → 9 个 provider 包（adapter/command/component/middleware/handler/tool/skill/agent-feature/mcp-feature）
// → runtime（RootHost 装配）→ isolate / config-file（依赖 runtime，仅契约）。
// packages/host/http-contract 是协议 Host 的最小端口（路由 + body），零业务依赖。
// packages/host/http 是具体 HTTP / WebSocket Host，仅依赖 basic + plugin-runtime。
const providerLayerAllowed = [
  'basic',
  'packages/im/im-contract',
  'packages/im/interaction',
  'packages/im/plugin-runtime',
  'packages/im/feature-kit',
];
const workroomAllowedLayers = [
  'packages/im/im-contract',
  'packages/im/ai',
  'packages/im/core',
  'packages/im/plugin-runtime',
  'packages/im/tool',
  'packages/im/skill',
  'packages/im/agent',
];
const layers = {
  // Console wire SSOT must remain zero-dependency so browsers, both Hosts and
  // external Console builds can share it without pulling runtime packages.
  'packages/console/protocol': { level: 0, allowedImports: [] },
  'packages/host/http-contract': { level: 0, allowedImports: [] },
  'basic/cli': { level: 0, allowedImports: ['basic', 'packages/im', 'packages/host', 'packages/console'] },
  'basic': { level: 0, allowedImports: ['basic'] },
  'packages/im/jsx': { level: 0, allowedImports: [] },
  'packages/toolkit/tailwind': { level: 0, allowedImports: ['packages/im/jsx'] },
  'packages/toolkit/components': { level: 0, allowedImports: ['packages/im/jsx'] },
  'packages/im/im-contract': { level: 0, allowedImports: [] },
  'packages/im/interaction': { level: 0, allowedImports: [] },
  'packages/im/plugin-runtime': { level: 1, allowedImports: ['basic'] },
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
  'packages/im/runtime': { level: 1, allowedImports: [...providerLayerAllowed, 'packages/im/adapter', 'packages/im/command', 'packages/im/component', 'packages/im/middleware', 'packages/im/handler', 'packages/im/tool', 'packages/im/skill', 'packages/im/agent-feature', 'packages/im/mcp-feature', 'packages/im/prompt-section'] },
  'packages/im/isolate': { level: 1, allowedImports: ['basic', 'packages/im/plugin-runtime', 'packages/im/runtime'] },
  'packages/im/config-file': { level: 1, allowedImports: ['basic', 'packages/im/plugin-runtime', 'packages/im/runtime'] },
  'packages/host/http': { level: 1, allowedImports: ['basic', 'packages/im/plugin-runtime', 'packages/console/protocol', 'packages/host/http-contract'] },
  'packages/im/kernel': { level: 1, allowedImports: ['basic'] },
  'packages/im/ai': { level: 2, allowedImports: ['basic', 'packages/im/kernel'] },
  'packages/im/core': { level: 3, allowedImports: ['packages/im/feature-kit', 'packages/im/jsx', 'basic', 'packages/im/im-contract', 'packages/im/kernel', 'packages/im/ai', 'packages/im/plugin-runtime', 'packages/im/adapter', 'packages/im/command', 'packages/im/component', 'packages/im/middleware', 'packages/im/handler'] },
  'packages/im/agent': { level: 4, allowedImports: ['basic', 'packages/im/im-contract', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/im/plugin-runtime', 'packages/im/agent-feature', 'packages/im/mcp-feature', 'packages/im/prompt-section', 'packages/im/skill', 'packages/im/tool'] },
  // Note: `level` is only an ordering hint. workroom and zhin both sit at 5 but are siblings with no import edge
  // between them (zhin does not import workroom; workroom does not import zhin), so their relative console
  // output order is not meaningful.
  // Workroom (A4b): sits above agent. workroom -> agent, never the reverse. Only src/workroom-runtime may use
  // agent; the domain directories (workroom/, portfolio/, data-governance/) stay framework-free (see below).
  'packages/im/workroom': { level: 5, allowedImports: workroomAllowedLayers },
  // define-plugin.ts 是 @zhin.js/plugin-runtime 的门面 re-export（zhin.js/plugin-runtime 子路径），允许。
  // ADR 0044 §3: shared OneBot-family raw event → canonical side event mapping; adapters depend on it, core never does.
  'packages/im/adapter-onebot-events': { level: 4, allowedImports: ['basic', 'packages/im/core', 'packages/im/adapter', 'packages/im/im-contract'] },
  'packages/im/zhin': { level: 5, allowedImports: ['packages/im/jsx', 'basic', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/im/agent', 'packages/im/runtime', 'packages/im/plugin-runtime'] },
  // Protocol Hosts consume only the narrow HTTP route contract; they must not
  // depend on the concrete HTTP Host implementation.
  'packages/host/mcp': { level: 7, allowedImports: ['basic', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/host/http-contract'] },
  'packages/host/a2a': { level: 7, allowedImports: ['basic', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/host/http-contract'] },
  'packages/console/contract': { level: 10, allowedImports: ['basic', 'packages/im/ai', 'packages/console/protocol'] },
  'packages/console/pagemanager': { level: 11, allowedImports: ['basic', 'packages/console/contract', 'packages/im/plugin-runtime', 'packages/im/feature-kit', 'packages/im/runtime'] },
  'packages/console/client': { level: 12, allowedImports: ['basic', 'packages/console/protocol', 'packages/console/contract'] },
};

// 重叠层级（basic/cli ⊂ basic）按最长路径优先解析
const layerPathsBySpecificity = Object.keys(layers).sort((a, b) => b.length - a.length);

// 包名到路径的映射
const packageNameToPath = {
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
  '@zhin.js/host-http-contract': 'packages/host/http-contract',
  '@zhin.js/mcp': 'packages/host/mcp',
  '@zhin.js/a2a': 'packages/host/a2a',
  '@zhin.js/plugin-runtime': 'packages/im/plugin-runtime',
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
  '@zhin.js/runtime': 'packages/im/runtime',
  '@zhin.js/isolate': 'packages/im/isolate',
  '@zhin.js/config-file': 'packages/im/config-file',
  '@zhin.js/interaction': 'packages/im/interaction',
  '@zhin.js/im-contract': 'packages/im/im-contract',
  '@zhin.js/workroom': 'packages/im/workroom',
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
    const imports = parseImports(content);

    if (sourceLayer.startsWith('packages/host/')
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

// Workroom may depend on the layers it composes (including agent); agent must never
// declare a manifest dependency on workroom, otherwise the packages form a cycle.
const workroomAllowedDependencies = new Set(workroomAllowedLayers.map(layer => (
  Object.entries(packageNameToPath).find(([, target]) => target === layer)?.[0]
)));
{
  const manifestPath = 'packages/im/workroom/package.json';
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, manifestPath), 'utf8'));
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(manifest[section] ?? {})) {
      if (workroomAllowedDependencies.has(dependency)) continue;
      violations.push({
        file: manifestPath,
        import: dependency,
        reason: `@zhin.js/workroom may only depend on ${[...workroomAllowedDependencies].join(', ')} (${section})`,
      });
    }
  }
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
  console.error('  4. packages/im/core (Plugin, Adapter, Endpoint, Command)');
  console.error('  5. packages/im/agent (ZhinAgent, security policies)');
  console.error('  6. packages/im/workroom (workroom -> agent, never the reverse)');
  console.error('  7. packages/im/zhin (main entry)');
  console.error('  (parallel) packages/console/{contract,pagemanager,client}\n');

  console.error('Each layer can only import from layers below it.');
  console.error('See CLAUDE.md for details.\n');

  process.exit(1);
}

console.log('Harness architecture layer check: OK (no layer violations found).');

// ── Assistant 反向依赖：低层不得 import @zhin.js/agent / assistant/ ──
const assistantForbiddenLayers = ['packages/im/kernel', 'packages/im/ai', 'packages/im/core'];
const assistantImportRe = /@zhin\.js\/agent(?:\/|$)/;
const assistantPathRe = /\/assistant\//;
const reverseViolations = [];

for (const layerPath of assistantForbiddenLayers) {
  const absPath = path.join(repoRoot, layerPath);
  const files = [];
  walkTs(absPath, files);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const importPath of parseImports(content)) {
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
  for (const importPath of parseImports(content)) {
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

// Workroom, Portfolio and Data Governance are domain modules. Their contracts
// and policies must remain independent from Agent configuration and Plugin
// Runtime composition. Runtime adapters may depend on these domains only in
// the opposite direction.
const agentDomainRoots = [
  'packages/im/workroom/src/workroom',
  'packages/im/workroom/src/portfolio',
  'packages/im/workroom/src/data-governance',
];
const agentRuntimeRoots = [
  path.join(repoRoot, 'packages/im/agent/src/config'),
  path.join(repoRoot, 'packages/im/agent/src/plugin-runtime'),
  path.join(repoRoot, 'packages/im/workroom/src/workroom-runtime'),
];
const agentDomainViolations = [];

for (const domainRoot of agentDomainRoots) {
  const files = [];
  walkTs(path.join(repoRoot, domainRoot), files);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const importPath of parseImports(content, { includeTypeOnly: true })) {
      if (isForbiddenDomainSpecifier(importPath)) {
        agentDomainViolations.push({
          file: path.relative(repoRoot, file),
          import: importPath,
          reason: `${domainRoot} may only import @zhin.js/im-contract and node: builtins (framework packages belong in workroom-runtime/)`,
        });
        continue;
      }
      if (!importPath.startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), importPath);
      const forbidden = agentRuntimeRoots.find(root => target === root || target.startsWith(`${root}${path.sep}`));
      if (!forbidden) continue;
      agentDomainViolations.push({
        file: path.relative(repoRoot, file),
        import: importPath,
        reason: `${domainRoot} must not depend on ${path.relative(repoRoot, forbidden)}`,
      });
    }
  }
}

if (agentDomainViolations.length) {
  console.error('\nHarness Agent domain boundary check: FAILED\n');
  for (const violation of agentDomainViolations) {
    console.error(`  ${violation.file}:`);
    console.error(`    Import: ${violation.import}`);
    console.error(`    Reason: ${violation.reason}\n`);
  }
  process.exit(1);
}

console.log('Harness Agent domain boundary check: OK.');

// Data Governance direction: workroom -> data-governance only, never the reverse.
const dataGovernanceRoot = path.join(repoRoot, 'packages/im/workroom/src/data-governance');
const dataGovernanceForbiddenRoots = ['workroom', 'workroom-runtime', 'portfolio']
  .map(name => path.join(repoRoot, 'packages/im/workroom/src', name));
const dataGovernanceViolations = [];
const dataGovernanceFiles = [];
walkTs(dataGovernanceRoot, dataGovernanceFiles);
for (const file of dataGovernanceFiles) {
  const content = fs.readFileSync(file, 'utf8');
  for (const hit of findForbiddenRelativeImports({ file, content, forbiddenRoots: dataGovernanceForbiddenRoots })) {
    const dir = path.basename(hit.root);
    dataGovernanceViolations.push({
      file: path.relative(repoRoot, file),
      import: hit.import,
      reason: `data-governance must not depend on ${dir}/ (data-governance is a lower layer shared by workroom, workroom-runtime and portfolio)`,
    });
  }
}

if (dataGovernanceViolations.length) {
  console.error('\nHarness Data Governance direction check: FAILED\n');
  for (const violation of dataGovernanceViolations) {
    console.error(`  ${violation.file}:`);
    console.error(`    Import: ${violation.import}`);
    console.error(`    Reason: ${violation.reason}\n`);
  }
  process.exit(1);
}

console.log('Harness Data Governance direction check: OK.');

// A4b: Agent is generic. No Agent source file (barrels included) may reference the
// Workroom package or any Workroom-owned directory; the dependency is workroom -> agent.
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
