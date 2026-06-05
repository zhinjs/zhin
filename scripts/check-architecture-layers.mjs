#!/usr/bin/env node
/**
 * Harness: 检查架构层级依赖是否正确
 *
 * 依赖层级（从低到高）：
 * 1. basic/ (logger, schema, database, cli)
 * 2. packages/im/kernel (无 IM 概念)
 * 3. packages/im/ai (providers, agents, memory)
 * 4. packages/im/core (Plugin, Adapter, Bot, Command)
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
const layers = {
  'basic': { level: 0, allowedImports: ['basic'] },
  'packages/im/kernel': { level: 1, allowedImports: ['basic'] },
  'packages/im/ai': { level: 2, allowedImports: ['basic', 'packages/im/kernel'] },
  'packages/im/core': { level: 3, allowedImports: ['basic', 'packages/im/kernel', 'packages/im/ai'] },
  'packages/im/agent': { level: 4, allowedImports: ['basic', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core'] },
  'packages/im/zhin': { level: 5, allowedImports: ['basic', 'packages/im/kernel', 'packages/im/ai', 'packages/im/core', 'packages/im/agent'] },
  'packages/console/contract': { level: 10, allowedImports: ['basic'] },
  'packages/console/pagemanager': { level: 11, allowedImports: ['basic', 'packages/console/contract'] },
  'packages/console/client': { level: 12, allowedImports: ['basic', 'packages/console/contract'] },
};

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

  for (const layerPath of Object.keys(layers)) {
    if (relativePath.startsWith(layerPath + '/') || relativePath.startsWith(layerPath + '\\')) {
      return layerPath;
    }
  }

  return null;
}

/**
 * 解析导入语句（忽略注释和模板字符串中的导入）
 * @param {string} content - 文件内容
 * @returns {string[]} - 导入的包名列表
 */
function parseImports(content) {
  const imports = [];
  const lines = content.split(/\r?\n/);

  let inTemplateString = false;
  let inComment = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // 处理多行注释
    if (trimmedLine.startsWith('/*')) {
      inComment = true;
    }
    if (inComment) {
      if (trimmedLine.includes('*/')) {
        inComment = false;
      }
      continue;
    }

    // 跳过单行注释
    if (trimmedLine.startsWith('//')) {
      continue;
    }

    // 处理模板字符串（简单检测）
    // 如果行包含反引号，可能是模板字符串的开始或结束
    const backtickCount = (line.match(/`/g) || []).length;
    if (backtickCount % 2 === 1) {
      inTemplateString = !inTemplateString;
    }

    // 如果在模板字符串中，跳过导入检测
    if (inTemplateString) {
      continue;
    }

    // 匹配 import 语句（只匹配行首的导入，避免匹配字符串中的导入）
    const importRegex = /^import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/;
    const match = importRegex.exec(trimmedLine);
    if (match) {
      imports.push(match[1]);
    }

    // 匹配 require 语句
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let requireMatch;
    while ((requireMatch = requireRegex.exec(line)) !== null) {
      imports.push(requireMatch[1]);
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

// 扫描所有源文件
for (const [layerPath, layerInfo] of Object.entries(layers)) {
  const absPath = path.join(repoRoot, layerPath);
  const files = [];
  walkTs(absPath, files);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const imports = parseImports(content);
    const relativeFilePath = path.relative(repoRoot, file);

    for (const importPath of imports) {
      const result = checkImport(layerPath, relativeFilePath, importPath);
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
  console.error('  4. packages/im/core (Plugin, Adapter, Bot, Command)');
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
