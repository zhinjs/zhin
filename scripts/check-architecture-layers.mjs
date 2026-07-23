#!/usr/bin/env node
/**
 * Harness: 检查架构层级依赖是否正确
 *
 * 依赖层级（从低到高）：
 * 1. basic/ (logger, schema, database, cli)
 * 2. packages/im/kernel (无 IM 概念)
 * 3. packages/im/ai (providers, agents, memory)
 * 4. packages/im/core (Plugin, Adapter, Endpoint, Command)
 * 5. packages/im/agent (ZhinAgent, security policies)
 * 6. packages/im/zhin (主入口)
 *
 * 禁止的导入：
 * - kernel 不能导入 core/agent/zhin
 * - ai 不能导入 core/agent/zhin
 * - core 不能导入 agent/zhin
 * - agent 不能导入 zhin
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

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
// → 8 个 provider 包（adapter/command/component/middleware/tool/skill/agent-feature/mcp-feature）
// → runtime（RootHost 装配）→ isolate / config-yaml（依赖 runtime，仅契约）。
// packages/host/http 是 HTTP Host 实现，仅依赖 basic + plugin-runtime。
const providerLayerAllowed = ['basic', 'packages/im/plugin-runtime', 'packages/im/feature-kit'];
const layers = {
  // Console wire SSOT must remain zero-dependency so browsers, both Hosts and
  // external Console builds can share it without pulling runtime packages.
  'packages/console/protocol': { level: 0, allowedImports: [] },
  'basic/cli': { level: 0, allowedImports: ['basic', 'packages/im', 'packages/host', 'packages/console'] },
  'basic': { level: 0, allowedImports: ['basic'] },
  'packages/im/plugin-runtime': { level: 1, allowedImports: ['basic'] },
  'packages/im/feature-kit': { level: 1, allowedImports: ['basic', 'packages/im/plugin-runtime'] },
  'packages/im/adapter': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/command': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/component': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/middleware': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/tool': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/skill': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/agent-feature': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/mcp-feature': { level: 1, allowedImports: providerLayerAllowed },
  'packages/im/runtime': { level: 1, allowedImports: [...providerLayerAllowed, 'packages/im/adapter', 'packages/im/command', 'packages/im/component', 'packages/im/middleware', 'packages/im/tool', 'packages/im/skill', 'packages/im/agent-feature', 'packages/im/mcp-feature'] },
  'packages/im/isolate': { level: 1, allowedImports: ['basic', 'packages/im/plugin-runtime', 'packages/im/runtime'] },
  'packages/im/config-yaml': { level: 1, allowedImports: ['basic', 'packages/im/plugin-runtime', 'packages/im/runtime'] },
  'packages/host/http': { level: 1, allowedImports: ['basic', 'packages/im/plugin-runtime', 'packages/console/protocol'] },
  'packages/im/kernel': { level: 1, allowedImports: ['basic'] },
  'packages/im/ai': { level: 2, allowedImports: ['basic', 'packages/im/kernel'] },
  'packages/im/core': { level: 3, allowedImports: ['basic', 'packages/im/kernel', 'packages/im/ai', 'packages/im/plugin-runtime', 'packages/im/adapter', 'packages/im/command', 'packages/im/component', 'packages/im/middleware'] },
  'packages/im/agent': { level: 4, allowedImports: ['basic', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/im/plugin-runtime', 'packages/im/agent-feature', 'packages/im/mcp-feature', 'packages/im/skill', 'packages/im/tool'] },
  // zhin 是应用伞包：shutdown.ts 以 try/catch 可选动态导入 @zhin.js/host-api（stopSseHub），无环，允许。
  'packages/im/zhin': { level: 5, allowedImports: ['basic', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/im/agent', 'packages/im/runtime', 'packages/host/api'] },
  'packages/host/router': { level: 6, allowedImports: ['basic', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/console/protocol'] },
  'packages/host/mcp': { level: 7, allowedImports: ['basic', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/host/router'] },
  'packages/host/api': { level: 8, allowedImports: ['basic', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/im/agent', 'packages/host/router', 'packages/host/mcp', 'packages/console/protocol', 'packages/console/contract', 'packages/console/pagemanager'] },
  'packages/console/contract': { level: 10, allowedImports: ['basic', 'packages/im/ai', 'packages/console/protocol'] },
  'packages/console/pagemanager': { level: 11, allowedImports: ['basic', 'packages/console/contract', 'packages/im/plugin-runtime', 'packages/im/feature-kit', 'packages/im/runtime'] },
  'packages/console/client': { level: 12, allowedImports: ['basic', 'packages/console/protocol', 'packages/console/contract'] },
};

// 重叠层级（basic/cli ⊂ basic）按最长路径优先解析
const layerPathsBySpecificity = Object.keys(layers).sort((a, b) => b.length - a.length);

// 包名到路径的映射
const packageNameToPath = {
  '@zhin.js/logger': 'basic/logger',
  '@zhin.js/schema': 'basic/schema',
  '@zhin.js/database': 'basic/database',
  '@zhin.js/cli': 'basic/cli',
  '@zhin.js/kernel': 'packages/im/kernel',
  '@zhin.js/ai': 'packages/im/ai',
  '@zhin.js/core': 'packages/im/core',
  '@zhin.js/agent': 'packages/im/agent',
  'zhin.js': 'packages/im/zhin',
  '@zhin.js/host-router': 'packages/host/router',
  '@zhin.js/host-api': 'packages/host/api',
  '@zhin.js/host-http': 'packages/host/http',
  '@zhin.js/mcp': 'packages/host/mcp',
  '@zhin.js/plugin-runtime': 'packages/im/plugin-runtime',
  '@zhin.js/feature-kit': 'packages/im/feature-kit',
  '@zhin.js/adapter': 'packages/im/adapter',
  '@zhin.js/command': 'packages/im/command',
  '@zhin.js/component': 'packages/im/component',
  '@zhin.js/middleware': 'packages/im/middleware',
  '@zhin.js/tool': 'packages/im/tool',
  '@zhin.js/skill': 'packages/im/skill',
  '@zhin.js/agent-feature': 'packages/im/agent-feature',
  '@zhin.js/mcp-feature': 'packages/im/mcp-feature',
  '@zhin.js/runtime': 'packages/im/runtime',
  '@zhin.js/isolate': 'packages/im/isolate',
  '@zhin.js/config-yaml': 'packages/im/config-yaml',
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
 * 抹掉注释与模板字符串内容（替换为空格、保留换行），
 * 使后续正则不会匹配到注释里或代码生成模板（如 packages/host/mcp
 * handlers.ts 生成插件源码的模板字符串）里的 "import ... from" 文本。
 * 普通字符串保留原样（模块说明符本身就在字符串里）。
 * @param {string} content
 * @returns {string}
 */
function maskCommentsAndTemplates(content) {
  const out = content.split('');
  // 状态栈：'code' | 'line' | 'block' | 'squote' | 'dquote' | 'template'
  // template 内的 ${ ... } 以括号深度回到 code 处理（支持嵌套模板）。
  const stack = [{ mode: 'code', braceDepth: 0 }];
  const top = () => stack[stack.length - 1];
  const mask = (i) => { if (out[i] !== '\n') out[i] = ' '; };

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    const st = top();

    if (st.mode === 'line') {
      mask(i);
      if (ch === '\n') stack.pop();
      continue;
    }
    if (st.mode === 'block') {
      mask(i);
      if (ch === '*' && next === '/') { mask(i + 1); i++; stack.pop(); }
      continue;
    }
    if (st.mode === 'squote' || st.mode === 'dquote') {
      if (ch === '\\') { i++; continue; }
      if ((st.mode === 'squote' && ch === "'") || (st.mode === 'dquote' && ch === '"')) stack.pop();
      continue;
    }
    if (st.mode === 'template') {
      if (ch === '\\') { mask(i); mask(i + 1); i++; continue; }
      if (ch === '`') { mask(i); stack.pop(); continue; }
      if (ch === '$' && next === '{') {
        mask(i); mask(i + 1); i++;
        stack.push({ mode: 'code', braceDepth: 0 });
        continue;
      }
      mask(i);
      continue;
    }

    // code 模式
    if (ch === '/' && next === '/') { mask(i); mask(i + 1); i++; stack.push({ mode: 'line' }); continue; }
    if (ch === '/' && next === '*') { mask(i); mask(i + 1); i++; stack.push({ mode: 'block' }); continue; }
    if (ch === "'") { stack.push({ mode: 'squote' }); continue; }
    if (ch === '"') { stack.push({ mode: 'dquote' }); continue; }
    if (ch === '`') { mask(i); stack.push({ mode: 'template' }); continue; }
    if (ch === '{') { st.braceDepth++; continue; }
    if (ch === '}' && stack.length > 1) {
      if (st.braceDepth === 0) stack.pop(); // ${ } 结束，回到 template
      else st.braceDepth--;
    }
  }
  return out.join('');
}

/**
 * 解析导入语句（忽略注释和模板字符串中的导入）。
 * 覆盖：单行/多行静态 import、bare import（import 'x'）、
 * export ... from '...' 再导出、动态 import('...')、require('...')。
 * 纯类型导入（import type / export type）不产生运行时依赖，跳过。
 * @param {string} content - 文件内容
 * @returns {string[]} - 导入的包名列表
 */
function parseImports(content) {
  const imports = [];
  const masked = maskCommentsAndTemplates(content);

  const patterns = [
    // 静态 import（含多行 import 块与 bare import），跳过 import type
    /import\s+(?!type\s)[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    // export { ... } from / export * from（含多行），跳过 export type
    /export\s+(?!type\s)(?:\*|\{[\s\S]*?\})\s*\bfrom\s*['"]([^'"]+)['"]/g,
    // 动态 import('...')（含 import('x').Type 内联类型；相对路径本就放行）
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // require('...')
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(masked)) !== null) {
      imports.push(match[1]);
    }
  }

  return imports;
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
// it. The Console wire protocol must remain safe for browsers and both Hosts.
const consoleProtocolManifest = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'packages/console/protocol/package.json'),
  'utf8',
));
for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const dependency of Object.keys(consoleProtocolManifest[section] ?? {})) {
    violations.push({
      file: 'packages/console/protocol/package.json',
      import: dependency,
      reason: `@zhin.js/console-protocol must remain zero-runtime-dependency (${section})`,
    });
  }
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
  console.error('  6. packages/im/zhin (main entry)');
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
