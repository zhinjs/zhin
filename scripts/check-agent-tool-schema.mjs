#!/usr/bin/env node
/**
 * Harness: agent/tools/*.ts inputSchema keys must appear in defineAgentTool<> (or legacy defineTool<>) and execute param types.
 * Monorepo files under plugins/ and examples/ must use defineAgentTool (defineTool is soft-deprecated alias).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const scanRoots = ['plugins', 'examples'];
const violations = [];

/**
 * @param {string} dir
 * @param {(filePath: string) => void} visit
 */
function walkTsTools(dir, visit) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'lib' || ent.name === 'dist') continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'tools' && path.basename(path.dirname(abs)) === 'agent') {
        for (const file of fs.readdirSync(abs).filter((f) => f.endsWith('.ts'))) {
          visit(path.join(abs, file));
        }
      } else {
        walkTsTools(abs, visit);
      }
    }
  }
}

for (const root of scanRoots) {
  walkTsTools(path.join(repoRoot, root), (filePath) => {
    const src = fs.readFileSync(filePath, 'utf8');
    const relFile = path.relative(repoRoot, filePath);

    if (/\binput\./.test(src)) {
      violations.push(`${relFile}: uses bare input.* (destructure from execute args)`);
    }

    if (!/\bdefineAgentTool\b/.test(src) && !/\bdefineTool\b/.test(src)) {
      violations.push(`${relFile}: missing defineAgentTool (or legacy defineTool) export`);
      return;
    }

    if (/\bdefineTool\b/.test(src) && !/\bdefineAgentTool\b/.test(src)) {
      violations.push(`${relFile}: use defineAgentTool (defineTool is deprecated alias)`);
    }

    const schemaMatch = src.match(/inputSchema:\s*z\.object\(\{([\s\S]*?)\}\)/);
    if (!schemaMatch) return;
    const schemaKeys = [...schemaMatch[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);

    const genericMatch = src.match(/define(?:Agent)?Tool<\{([^}]*)\}>/);
    const genericKeys = genericMatch
      ? [...genericMatch[1].matchAll(/(\w+)\??:/g)].map((m) => m[1])
      : null;

    const executeMatch = src.match(/async execute\(\{([^}]*)\}\s*:\s*\{([^}]*)\}/);
    const executeTypeKeys = executeMatch
      ? [...executeMatch[2].matchAll(/(\w+)\??:/g)].map((m) => m[1])
      : null;

    for (const key of schemaKeys) {
      if (genericKeys && !genericKeys.includes(key)) {
        violations.push(`${relFile}: inputSchema.${key} missing in defineAgentTool<>`);
      }
      if (executeTypeKeys && !executeTypeKeys.includes(key)) {
        violations.push(`${relFile}: inputSchema.${key} missing in execute param type`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error('Agent tool schema check: FAILED\n');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log('Agent tool schema check: OK');
