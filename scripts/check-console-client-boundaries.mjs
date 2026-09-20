#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [
  path.join(repoRoot, 'packages/console/client/client'),
  path.join(repoRoot, 'packages/console/contract/src'),
];
const violations = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(file);
      continue;
    }
    if (!/\.(?:ts|tsx)$/u.test(entry.name) || /\.test\.tsx?$/u.test(entry.name)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(repoRoot, file);
    const checks = [
      [/^let\s+[A-Za-z_$]/mu, 'module-level mutable Console state'],
      [/\b(?:globalWebSocketManager|getWebSocketManager|destroyWebSocketManager|resetWebSocketManager|runtimeEnvFn|WebSocketManager|useWebSocket)\b/u, 'legacy process-wide Console owner'],
      [/export\s+const\s+app\b/u, 'module-owned Console application singleton'],
      [/\baddPage\b/u, 'legacy addPage compatibility alias'],
      [/export\s+type\s+MessageElement\s*=\s*MessageSegment/u, 'legacy MessageElement compatibility alias'],
    ];
    for (const [pattern, label] of checks) {
      const match = pattern.exec(source);
      if (!match) continue;
      violations.push({
        file: relative,
        line: source.slice(0, match.index).split(/\r?\n/u).length,
        label,
      });
    }
  }
}

for (const root of roots) visit(root);

if (violations.length > 0) {
  console.error('Console client boundary check: FAILED\n');
  console.error('Keep browser runtime state inside an explicitly created ConsoleClient.\n');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.label}`);
  }
  process.exit(1);
}

console.log('Console client boundary check: passed');
