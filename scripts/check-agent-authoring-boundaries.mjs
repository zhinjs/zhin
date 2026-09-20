#!/usr/bin/env node
/** Enforce the canonical main-Agent and named sub-agent filesystem contract. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoots = ['basic', 'packages', 'plugins', 'examples'];
const ignored = new Set(['node_modules', 'lib', 'dist', '.git', '.github', 'data']);
const coreFiles = ['agent.json', 'system.md', 'boundaries.md', 'conventions.md'];
const requiredEntries = ['system.md', 'boundaries.md', 'conventions.md'];
const violations = [];

scanLegacy(repoRoot);
rejectPackageRootAgentDirectory(repoRoot, undefined);
validateNamedIndexRoot(path.join(repoRoot, 'prompt-sections'), 'Prompt Section');
validateAgentsRoot(path.join(repoRoot, 'agents'), undefined);
for (const workspaceRoot of workspaceRoots) {
  for (const packageJson of packageManifests(path.join(repoRoot, workspaceRoot))) {
    const packageRoot = path.dirname(packageJson);
    const manifest = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    rejectPackageRootAgentDirectory(packageRoot, manifest);
    validateNamedIndexRoot(path.join(packageRoot, 'prompt-sections'), 'Prompt Section');
    const agentsRoot = path.join(packageRoot, 'agents');
    const count = validateAgentsRoot(agentsRoot, manifest);
    if (count > 0) {
      if (manifest.private !== true && !manifest.files?.includes('agents')) {
        violations.push(`${relative(packageJson)}: files must include agents`);
      }
      if (manifest.dependencies?.['@zhin.js/agent-feature'] !== 'workspace:*') {
        violations.push(`${relative(packageJson)}: must depend on @zhin.js/agent-feature`);
      }
      if (!manifest.zhin?.features?.some((feature) => feature.package === '@zhin.js/agent-feature')) {
        violations.push(`${relative(packageJson)}: must mount the @zhin.js/agent-feature Feature`);
      }
    }
    if (fs.existsSync(path.join(packageRoot, 'AGENTS.md'))
      && manifest.private !== true && !manifest.files?.includes('AGENTS.md')) {
      violations.push(`${relative(packageJson)}: files must include AGENTS.md`);
    }
  }
}

if (violations.length) {
  console.error('check-agent-authoring-boundaries: FAILED\n');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}
console.log('check-agent-authoring-boundaries: OK');

function scanLegacy(directory) {
  for (const entry of safeEntries(directory)) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'lib'
      || entry.name === 'dist' || entry.name === 'docs' || entry.name === 'data') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'subagents' && path.basename(directory) === 'agent') {
        violations.push(`${relative(target)}: legacy agent/subagents directory`);
      }
      scanLegacy(target);
      continue;
    }
    if (entry.name.endsWith('.agent.md')) {
      violations.push(`${relative(target)}: legacy single-file Agent; use agents/<name>/agent.json`);
    }
    if (path.basename(directory) === 'agent' && (entry.name === 'agent.ts' || entry.name === 'instructions.md')) {
      violations.push(`${relative(target)}: legacy main Agent file; use package-root AGENTS.md`);
    }
  }
}

function validateAgentsRoot(root, manifest) {
  if (!fs.existsSync(root)) return 0;
  const adapter = relative(root).match(/^plugins\/adapters\/([^/]+)\/agents$/u)?.[1];
  let count = 0;
  for (const entry of safeEntries(root)) {
    const target = path.join(root, entry.name);
    if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]*$/u.test(entry.name)) {
      violations.push(`${relative(target)}: Agent must be a lowercase kebab-case directory`);
      continue;
    }
    count += 1;
    for (const core of coreFiles) {
      if (!fs.existsSync(path.join(target, core))) violations.push(`${relative(target)}: missing ${core}`);
    }
    const manifestPath = path.join(target, 'agent.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const agent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/u.test(agent.version ?? '')) {
        violations.push(`${relative(manifestPath)}: version must be semantic version`);
      }
      if (!Array.isArray(agent.entry_points)
        || requiredEntries.some((name) => !agent.entry_points.includes(name))) {
        violations.push(`${relative(manifestPath)}: entry_points must include all core Markdown files`);
      }
      if (!agent.trigger_rules || !Array.isArray(agent.trigger_rules.file_patterns)
        || !Array.isArray(agent.trigger_rules.keywords)) {
        violations.push(`${relative(manifestPath)}: trigger_rules must declare file_patterns and keywords arrays`);
      }
      if (adapter && entry.name !== adapter) {
        violations.push(`${relative(target)}: Adapter Agent name must match platform ${adapter}`);
      }
      if (adapter && (!Array.isArray(agent.platforms)
        || agent.platforms.length !== 1 || agent.platforms[0] !== adapter)) {
        violations.push(`${relative(manifestPath)}: Adapter Agent platforms must be [${adapter}]`);
      }
    } catch (error) {
      violations.push(`${relative(manifestPath)}: invalid JSON (${error.message})`);
    }
  }
  return count;
}

function rejectPackageRootAgentDirectory(packageRoot, manifest) {
  if (fs.existsSync(path.join(packageRoot, 'agent'))) {
    violations.push(`${relative(path.join(packageRoot, 'agent'))}: package-root agent/ is removed`);
  }
  if (manifest?.files?.includes('agent')) {
    violations.push(`${relative(path.join(packageRoot, 'package.json'))}: files must not include removed agent/`);
  }
}

function validateNamedIndexRoot(root, label) {
  if (!fs.existsSync(root)) return;
  for (const entry of safeEntries(root)) {
    const target = path.join(root, entry.name);
    if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]*$/u.test(entry.name)) {
      violations.push(`${relative(target)}: ${label} must be a lowercase kebab-case directory`);
      continue;
    }
    if (!['index.ts', 'index.js', 'index.mjs', 'index.cjs']
      .some((name) => fs.existsSync(path.join(target, name)))) {
      violations.push(`${relative(target)}: ${label} must provide index.ts or compiled JavaScript`);
    }
  }
}

function safeEntries(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !ignored.has(entry.name));
}

function relative(target) {
  return path.relative(repoRoot, target).split(path.sep).join('/');
}

function* packageManifests(directory) {
  for (const entry of safeEntries(directory)) {
    if (!entry.isDirectory()) continue;
    const target = path.join(directory, entry.name);
    const manifest = path.join(target, 'package.json');
    if (fs.existsSync(manifest)) yield manifest;
    else yield* packageManifests(target);
  }
}
