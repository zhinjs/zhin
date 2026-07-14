#!/usr/bin/env node
/**
 * Harness: agent/tools/*.ts inputSchema keys must appear in defineTool<> and execute param types.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const roots = ['plugins/adapters', 'plugins/utils', 'plugins/services', 'plugins/features', 'plugins/games'];
const violations = [];

for (const root of roots) {
  const absRoot = path.join(repoRoot, root);
  if (!fs.existsSync(absRoot)) continue;
  for (const pkg of fs.readdirSync(absRoot)) {
    const toolsDir = path.join(absRoot, pkg, 'agent', 'tools');
    if (!fs.existsSync(toolsDir)) continue;
    const rel = path.relative(repoRoot, toolsDir);
    for (const file of fs.readdirSync(toolsDir).filter((f) => f.endsWith('.ts'))) {
      const filePath = path.join(toolsDir, file);
      const src = fs.readFileSync(filePath, 'utf8');
      const relFile = path.relative(repoRoot, filePath);

      if (/\binput\./.test(src)) {
        violations.push(`${relFile}: uses bare input.* (destructure from execute args)`);
      }

      const schemaMatch = src.match(/inputSchema:\s*z\.object\(\{([\s\S]*?)\}\)/);
      if (!schemaMatch) continue;
      const schemaKeys = [...schemaMatch[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);

      const genericMatch = src.match(/defineTool<\{([^}]*)\}>/);
      const genericKeys = genericMatch
        ? [...genericMatch[1].matchAll(/(\w+)\??:/g)].map((m) => m[1])
        : null;

      const executeMatch = src.match(/async execute\(\{([^}]*)\}\s*:\s*\{([^}]*)\}/);
      const executeTypeKeys = executeMatch
        ? [...executeMatch[2].matchAll(/(\w+)\??:/g)].map((m) => m[1])
        : null;

      for (const key of schemaKeys) {
        if (genericKeys && !genericKeys.includes(key)) {
          violations.push(`${relFile}: inputSchema.${key} missing in defineTool<>`);
        }
        if (executeTypeKeys && !executeTypeKeys.includes(key)) {
          violations.push(`${relFile}: inputSchema.${key} missing in execute param type`);
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Agent tool schema check: FAILED\n');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log('Agent tool schema check: OK');
