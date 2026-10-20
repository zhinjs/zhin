#!/usr/bin/env node
/** Offline acceptance candidates; passing this does not promote a platform's stability tier. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { platformSmokeSuites } from './adapter-meta.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suites = [...platformSmokeSuites(),
  'packages/im/adapter/tests/adapter.test.ts', 'packages/im/adapter/tests/endpoint-lifecycle.test.ts'];
for (const suite of suites) {
  if (!existsSync(path.join(root, suite))) throw new Error(`Missing platform acceptance suite: ${suite}`);
}
execFileSync('pnpm', ['exec', 'vitest', 'run', ...suites], { cwd: root, stdio: 'inherit' });
console.log('Platform offline contracts passed. Public stability tiers are unchanged.');
