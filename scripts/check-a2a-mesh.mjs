#!/usr/bin/env node
/**
 * Fail if legacy MCP Agent Mesh tools are re-introduced.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitGrepSource } from './lib/git-grep-source.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const patterns = [
  'registerAgentMeshTools',
  'register-agent-mesh-mcp',
  'mcp-mesh-registrar',
];

let failed = false;
for (const pattern of patterns) {
  const output = gitGrepSource({
    repoRoot,
    pattern,
    paths: ['packages/im', 'packages/host'],
    excludeGlobs: ['**/node_modules/**', '**/lib/**'],
  });
  if (output) {
    console.error(`[check:a2a-mesh] Forbidden pattern "${pattern}" found in:\n${output}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log('[check:a2a-mesh] OK — no legacy MCP Agent Mesh symbols');
