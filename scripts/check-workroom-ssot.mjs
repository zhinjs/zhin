#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbidden = [
  'OrchestrationService',
  'AgentDispatcher',
  'MemoryOrchestrationRepository',
  'DatabaseOrchestrationRepository',
  'repositoryHandle',
  'dispatcherHandle',
];

let failed = false;
for (const pattern of forbidden) {
  try {
    const output = execFileSync('rg', [
      '-n', pattern,
      'packages/im/agent/src',
      'basic/cli/src/plugin-runtime',
      '--glob', '!**/lib/**',
    ], { cwd: repoRoot, encoding: 'utf8' }).trim();
    if (output) {
      console.error(`[check:workroom-ssot] forbidden parallel authority "${pattern}":\n${output}`);
      failed = true;
    }
  } catch (error) {
    if (error?.status !== 1) throw error;
  }
}

if (failed) process.exit(1);
execFileSync('pnpm', [
  'exec', 'vitest', 'run',
  'packages/im/agent/tests/workroom/workroom-kernel.test.ts',
], { cwd: repoRoot, stdio: 'inherit' });
console.log('[check:workroom-ssot] OK — Journal + CAS Kernel is the sole Workroom authority');
