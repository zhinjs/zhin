#!/usr/bin/env node
/**
 * Queue Beta smoke：queue-runtime Vitest + minimal-qbot 启动脚本。
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('Queue Beta: building @zhin.js/queue-runtime…');
execSync('pnpm --filter @zhin.js/queue-runtime build', { cwd: repoRoot, stdio: 'inherit' });

console.log('\nQueue Beta: running queue-runtime tests…');
execSync('pnpm --filter @zhin.js/queue-runtime test', { cwd: repoRoot, stdio: 'inherit' });

console.log('\nQueue Beta: minimal-qbot start…');
execSync('pnpm start', {
  cwd: path.join(repoRoot, 'examples/minimal-qbot'),
  stdio: 'inherit',
});

console.log('\nQueue Beta smoke passed.\n');
