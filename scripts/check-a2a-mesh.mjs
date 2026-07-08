#!/usr/bin/env node
/**
 * Fail if legacy MCP Agent Mesh tools are re-introduced.
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const patterns = [
  'registerAgentMeshTools',
  'register-agent-mesh-mcp',
  'mcp-mesh-registrar',
];

let failed = false;
for (const pattern of patterns) {
  try {
    const out = execSync(
      `rg -l "${pattern}" packages/im packages/host --glob '!**/node_modules/**' --glob '!**/lib/**' || true`,
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim();
    if (out) {
      console.error(`[check:a2a-mesh] Forbidden pattern "${pattern}" found in:\n${out}`);
      failed = true;
    }
  } catch {
    // rg not found or no matches
  }
}

if (failed) {
  process.exit(1);
}
console.log('[check:a2a-mesh] OK — no legacy MCP Agent Mesh symbols');
