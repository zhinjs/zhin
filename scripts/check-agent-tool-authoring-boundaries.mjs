#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoots = ['basic', 'packages', 'plugins', 'examples'];
const ignoredDirectories = new Set(['node_modules', 'lib', 'dist', '.git']);
const violations = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else files.push(target);
  }
  return files;
}

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

function report(file, label, line = 1) {
  violations.push({ file: relative(file), line, label });
}

function lineOf(content, index) {
  return content.slice(0, index).split(/\r?\n/u).length;
}

function findPackageRoot(file) {
  let current = path.dirname(file);
  while (current.startsWith(repoRoot)) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

const files = workspaceRoots.flatMap((root) => walk(path.join(repoRoot, root)));
const packageRoots = new Set();
for (const file of files) {
  const content = /\.(?:[cm]?[jt]sx?|json)$/u.test(file)
    ? fs.readFileSync(file, 'utf8')
    : '';
  const oldImport = /(?:from\s+|import\(\s*)['"]@zhin\.js\/agent\/tools['"]/u.exec(content);
  if (oldImport) report(file, 'removed @zhin.js/agent/tools import', lineOf(content, oldImport.index));
  const coreZodImport = /(?:from\s+|import\(\s*)['"]@zhin\.js\/core\/tool-zod['"]/u.exec(content);
  if (coreZodImport) report(file, 'removed @zhin.js/core/tool-zod import', lineOf(content, coreZodImport.index));

  if (!/^\$.*\.ts$/u.test(path.basename(file))) continue;
  const packageRoot = findPackageRoot(file);
  if (!packageRoot) continue;
  const packageRelative = path.relative(packageRoot, file).split(path.sep).join('/');
  if (packageRelative.startsWith('tools/')) {
    report(file, 'package-root tools/$*.ts entry; use agent/tools/$*.ts');
  }
  if (packageRelative.startsWith('agent/tools/')) packageRoots.add(packageRoot);
}

for (const packageRoot of packageRoots) {
  const manifestPath = path.join(packageRoot, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.dependencies?.['@zhin.js/tool'] !== 'workspace:*') {
    report(manifestPath, 'agent/tools package must depend on @zhin.js/tool');
  }
  if (!manifest.zhin?.features?.some((feature) => feature.package === '@zhin.js/tool')) {
    report(manifestPath, 'agent/tools package must mount the @zhin.js/tool Feature');
  }
}

const agentManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/im/agent/package.json'), 'utf8'));
if (agentManifest.exports?.['./tools']) {
  report(path.join(repoRoot, 'packages/im/agent/package.json'), 'removed ./tools export restored');
}

const agentIndexPath = path.join(repoRoot, 'packages/im/agent/src/index.ts');
const agentIndex = fs.readFileSync(agentIndexPath, 'utf8');
for (const removedToolRegistryApi of [
  'ToolRegistryAsService',
  'ToolRegistry',
  'ZhinTool',
  'defineTool',
  'extractParamInfo',
  'createBuiltinTools',
  'ReadFileBuiltinTool',
  'WriteFileBuiltinTool',
  'EditFileBuiltinTool',
  'ListDirBuiltinTool',
  'GlobBuiltinTool',
  'GrepBuiltinTool',
  'WebFetchBuiltinTool',
  'TodoReadBuiltinTool',
  'TodoWriteBuiltinTool',
  'RunDeferredTaskBuiltinTool',
  'createRunDeferredTaskTool',
  'AnalyzeMediaBuiltinTool',
  'createAnalyzeMediaTool',
]) {
  const match = new RegExp(`\\b${removedToolRegistryApi}\\b`, 'u').exec(agentIndex);
  if (match) {
    report(
      agentIndexPath,
      `removed ResourceHub Tool API restored: ${removedToolRegistryApi}`,
      lineOf(agentIndex, match.index),
    );
  }
}
for (const removedRegistryPath of [
  'packages/im/agent/src/resource-hub/tool-registry.ts',
  'packages/im/agent/src/tool/tool-registry-as-service.ts',
  'packages/im/agent/src/builtin-tools.ts',
  'packages/im/agent/src/builtin/read-file-tool.ts',
  'packages/im/agent/src/builtin/write-file-tool.ts',
  'packages/im/agent/src/builtin/edit-file-tool.ts',
  'packages/im/agent/src/builtin/list-dir-tool.ts',
  'packages/im/agent/src/builtin/glob-tool.ts',
  'packages/im/agent/src/builtin/grep-tool.ts',
  'packages/im/agent/src/builtin/web-fetch-tool.ts',
  'packages/im/agent/src/builtin/todo-read-tool.ts',
  'packages/im/agent/src/builtin/todo-write-tool.ts',
  'packages/im/agent/src/builtin/generate-image-tool.ts',
  'packages/im/agent/src/builtin/run-deferred-task-tool.ts',
  'packages/im/agent/src/builtin/analyze-media-tool.ts',
]) {
  const target = path.join(repoRoot, removedRegistryPath);
  if (fs.existsSync(target)) report(target, 'removed ResourceHub Tool registry restored');
}

const retiredToolNames = ['tool_search', 'run_deferred_task', 'analyze_media'];
for (const file of files) {
  const fileName = relative(file);
  if (!fileName.endsWith('.ts')) continue;
  if (!fileName.startsWith('packages/im/agent/src/') && !fileName.startsWith('basic/cli/src/')) continue;
  const content = fs.readFileSync(file, 'utf8');
  for (const name of retiredToolNames) {
    const match = new RegExp(`\\b${name}\\b`, 'u').exec(content);
    if (match) report(file, `retired Tool protocol restored: ${name}`, lineOf(content, match.index));
  }
}

const coreManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/im/core/package.json'), 'utf8'));
if (coreManifest.exports?.['./tool-zod']) {
  report(path.join(repoRoot, 'packages/im/core/package.json'), 'removed ./tool-zod export restored');
}

if (violations.length > 0) {
  console.error('Agent Tool authoring boundary check: FAILED\n');
  console.error('Use one authoring surface: @zhin.js/tool + agent/tools/$*.ts.\n');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.label}`);
  }
  process.exit(1);
}

console.log(`Agent Tool authoring boundary check: passed (${packageRoots.size} packages)`);
