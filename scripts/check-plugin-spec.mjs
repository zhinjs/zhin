#!/usr/bin/env node
/**
 * Harness: 检查插件是否符合规范
 * - 检查插件入口文件是否存在
 * - 检查插件是否有正确的 package.json
 * - 检查插件是否使用了正确的导入路径
 * - 检查插件是否有测试文件
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const pluginDirs = [
  'plugins/adapters',
  'packages/host',
  'plugins/services',
  'plugins/features',
  'plugins/games',
  'plugins/utils',
];

/** 非插件目录（共享代码、工具文件夹） */
const SKIP_PLUGIN_NAMES = new Set(['common']);

const violations = [];

/**
 * 检查单个插件目录
 * @param {string} pluginPath - 插件目录路径
 * @param {string} pluginName - 插件名称
 */
function checkPlugin(pluginPath, pluginName) {
  const relativePath = path.relative(repoRoot, pluginPath);

  // 检查 package.json 是否存在
  const packageJsonPath = path.join(pluginPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    violations.push({
      plugin: relativePath,
      issue: 'Missing package.json',
    });
    return;
  }

  // 读取 package.json
  let packageJson;
  try {
    const content = fs.readFileSync(packageJsonPath, 'utf8');
    packageJson = JSON.parse(content);
  } catch (error) {
    violations.push({
      plugin: relativePath,
      issue: `Invalid package.json: ${error.message}`,
    });
    return;
  }

  // 检查是否有 name 字段
  if (!packageJson.name) {
    violations.push({
      plugin: relativePath,
      issue: 'Missing "name" field in package.json',
    });
  }

  // 检查是否有 main 或 exports 字段
  if (!packageJson.main && !packageJson.exports) {
    violations.push({
      plugin: relativePath,
      issue: 'Missing "main" or "exports" field in package.json',
    });
  }

  // 检查 src 目录是否存在
  const srcDir = path.join(pluginPath, 'src');
  if (!fs.existsSync(srcDir)) {
    violations.push({
      plugin: relativePath,
      issue: 'Missing src/ directory',
    });
    return;
  }

  // 检查入口文件是否存在
  const entryFile = packageJson.main
    ? path.join(pluginPath, packageJson.main.replace('./lib/', './src/').replace('.js', '.ts'))
    : path.join(srcDir, 'index.ts');

  // Accept both .ts and .tsx entry files (common for JSX-rendering plugins)
  const entryFileTsx = entryFile.replace(/\.ts$/, '.tsx');

  if (!fs.existsSync(entryFile) && !fs.existsSync(entryFileTsx)) {
    violations.push({
      plugin: relativePath,
      issue: `Entry file not found: ${path.relative(repoRoot, entryFile)}`,
    });
  }

  // 检查是否有测试文件
  const testsDir = path.join(pluginPath, 'tests');
  const hasTests = fs.existsSync(testsDir) && fs.readdirSync(testsDir).some(f => f.endsWith('.test.ts'));

  if (!hasTests) {
    violations.push({
      plugin: relativePath,
      issue: 'No test files found (tests/*.test.ts)',
    });
  }

  // 检查是否有 README
  const readmePath = path.join(pluginPath, 'README.md');
  if (!fs.existsSync(readmePath)) {
    violations.push({
      plugin: relativePath,
      issue: 'Missing README.md',
    });
  }
}

/**
 * 扫描插件目录
 * @param {string} dir - 要扫描的目录
 */
function shouldCheckPlugin(pluginPath) {
  if (SKIP_PLUGIN_NAMES.has(path.basename(pluginPath))) return false;
  const hasPackageJson = fs.existsSync(path.join(pluginPath, 'package.json'));
  const hasSrc = fs.existsSync(path.join(pluginPath, 'src'));
  // 仅校验有意图的插件目录（含 package.json 或 src/）；跳过 lib 残留等
  return hasPackageJson || hasSrc;
}

function scanPluginDir(dir) {
  const absPath = path.join(repoRoot, dir);
  if (!fs.existsSync(absPath)) return;

  for (const name of fs.readdirSync(absPath)) {
    const pluginPath = path.join(absPath, name);
    const stat = fs.statSync(pluginPath);

    if (stat.isDirectory() && !name.startsWith('.') && name !== 'node_modules') {
      if (!shouldCheckPlugin(pluginPath)) continue;
      checkPlugin(pluginPath, name);
    }
  }
}

// 扫描所有插件目录
for (const dir of pluginDirs) {
  scanPluginDir(dir);
}

if (violations.length) {
  console.error('Harness plugin spec check: FAILED\n');
  for (const v of violations) {
    console.error(`  ${v.plugin}: ${v.issue}`);
  }
  console.error('\nPlugins must follow the standard structure. See docs/guide/ for details.\n');
  process.exit(1);
}

console.log('Harness plugin spec check: OK (all plugins follow the spec).');
