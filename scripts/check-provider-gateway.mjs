#!/usr/bin/env node
/**
 * Provider gateway contract — sdk/baseUrl presets for known LLM proxies.
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  execSync(
    'pnpm vitest run packages/im/ai/tests/llm/provider-gateway-presets.test.ts packages/im/agent/tests/config/fix-ai-config.test.ts -t "provider gateway"',
    { cwd: repoRoot, stdio: 'inherit' },
  );
  console.log('Harness provider gateway check: OK.');
} catch {
  console.error('Harness provider gateway check: FAILED.');
  process.exit(1);
}
