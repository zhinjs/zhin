#!/usr/bin/env node
/**
 * Speech is an optional implementation owned by the CLI composition root.
 * Core and Agent may depend only on an explicitly injected transcription port.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanRoots = [
  'packages/im/core/src',
  'packages/im/agent/src',
  'basic/logger/src',
];
const forbidden = [
  /@zhin\.js\/speech/,
  /\b(?:load|seed|reset)SpeechPipeline\b/,
  /\b(?:create|reset)WarnOnce(?:ForTests)?\b/,
];
const violations = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      walk(file);
      continue;
    }
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      const match = pattern.exec(source);
      if (!match) continue;
      violations.push({
        file: path.relative(repoRoot, file),
        line: source.slice(0, match.index).split(/\r?\n/).length,
        token: match[0],
      });
    }
  }
}

for (const root of scanRoots) walk(path.join(repoRoot, root));

const hostSource = fs.readFileSync(
  path.join(repoRoot, 'basic/cli/src/plugin-runtime/speech-host-installer.ts'),
  'utf8',
);
if (!hostSource.includes("import('@zhin.js/speech')") || !hostSource.includes('AudioTranscriptionPort')) {
  violations.push({
    file: 'basic/cli/src/plugin-runtime/speech-host-installer.ts',
    line: 1,
    token: 'missing composition-root Speech ownership',
  });
}

if (violations.length > 0) {
  console.error('Harness Speech runtime boundary check: FAILED\n');
  console.error('Keep Speech loading in the CLI composition root and inject AudioTranscriptionPort explicitly.\n');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.token}`);
  }
  process.exit(1);
}

console.log('Harness Speech runtime boundary check: OK.');
