#!/usr/bin/env node
/**
 * Harness: plugins with agent/ must ship publishable artifacts.
 * - package.json "files" includes agent, lib, evals (when present), tools handlers (60s)
 * - prepublishOnly runs build so lib/agent/*.js is in the tarball
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const pluginRoots = [
  'plugins/adapters',
  'plugins/utils',
  'plugins/services',
  'plugins/features',
  'plugins/games',
];

const SKIP = new Set(['common']);
const violations = [];

function hasAgentToolsHandlers(pluginPath) {
  const toolsDir = path.join(pluginPath, 'tools');
  if (!fs.existsSync(toolsDir)) return false;
  return fs.readdirSync(toolsDir).some((name) => {
    const handler = path.join(toolsDir, name, 'handler.ts');
    return fs.existsSync(handler);
  });
}

function checkPlugin(pluginPath) {
  const rel = path.relative(repoRoot, pluginPath);
  const agentDir = path.join(pluginPath, 'agent');
  if (!fs.existsSync(agentDir)) return;

  const pkgPath = path.join(pluginPath, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    violations.push(`${rel}: has agent/ but no package.json`);
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const files = new Set(pkg.files || []);

  const required = ['agent', 'lib', 'src'];
  for (const item of required) {
    if (!files.has(item)) {
      violations.push(`${rel}: package.json "files" must include "${item}" (agent authoring publish)`);
    }
  }

  if (fs.existsSync(path.join(pluginPath, 'evals')) && !files.has('evals')) {
    violations.push(`${rel}: package.json "files" must include "evals"`);
  }

  if (hasAgentToolsHandlers(pluginPath) && !files.has('tools')) {
    violations.push(`${rel}: package.json "files" must include "tools" (runtime handlers for agent tools)`);
  }

  if (!pkg.scripts?.build) {
    violations.push(`${rel}: missing "build" script (required before npm publish)`);
  }

  if (!pkg.scripts?.prepublishOnly) {
    violations.push(`${rel}: missing "prepublishOnly" script (should run build before publish)`);
  } else if (!/build/.test(pkg.scripts.prepublishOnly)) {
    violations.push(`${rel}: prepublishOnly should invoke build (${pkg.scripts.prepublishOnly})`);
  }

  if (pkg.dependencies?.['@zhin.js/agent']) {
    violations.push(`${rel}: @zhin.js/agent must not be in dependencies (use optional peer + devDependencies)`);
  }
}

for (const root of pluginRoots) {
  const abs = path.join(repoRoot, root);
  if (!fs.existsSync(abs)) continue;
  for (const name of fs.readdirSync(abs)) {
    if (SKIP.has(name)) continue;
    const pluginPath = path.join(abs, name);
    if (!fs.statSync(pluginPath).isDirectory()) continue;
    checkPlugin(pluginPath);
  }
}

if (violations.length) {
  console.error('Harness plugin agent publish check: FAILED\n');
  for (const v of violations) console.error(`  - ${v}`);
  console.error('\nSee docs/advanced/agent-authoring.md (npm publish).\n');
  process.exit(1);
}

console.log('Harness plugin agent publish check: OK');
