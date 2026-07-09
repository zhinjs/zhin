#!/usr/bin/env node
/**
 * Orchestration SSOT — task status transitions must go through OrchestrationKernel,
 * not repositoryHandle.updateTaskStatus bypass (ADR 0027).
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentSrc = path.join(repoRoot, 'packages/im/agent/src');

const ssotVitestFiles = [
  'packages/im/agent/tests/orchestrator/orchestration-kernel.test.ts',
  'packages/im/agent/tests/orchestrator/executor-contract.test.ts',
  'packages/im/agent/tests/a2a/delegation-message.test.ts',
  'packages/im/agent/tests/collaboration/collaboration-kernel-bridge.test.ts',
  'packages/im/agent/tests/collaboration/inbound-turn-pipeline.test.ts',
  'packages/im/agent/tests/collaboration/inbound-turn-route.test.ts',
  'packages/im/agent/tests/config/validate-ai-config.test.ts',
  'packages/im/agent/tests/routing/route-matcher.test.ts',
  'packages/im/agent/tests/remote-loopback.test.ts',
];

try {
  const bypassOut = execSync(
    `rg -n "repositoryHandle\\.updateTaskStatus" "${agentSrc}" || true`,
    { cwd: repoRoot, encoding: 'utf8' },
  ).trim();
  if (bypassOut) {
    console.error('Harness orchestration SSOT check: FAILED.');
    console.error('Direct repositoryHandle.updateTaskStatus bypasses OrchestrationKernel:');
    console.error(bypassOut);
    process.exit(1);
  }

  const failBypassOut = execSync(
    `rg -n "updateTaskStatus\\([^,]+, .failed" "${agentSrc}" || true`,
    { cwd: repoRoot, encoding: 'utf8' },
  ).trim();
  const failBypassLines = failBypassOut
    .split('\n')
    .filter((line) => line && !line.includes('orchestration-service.ts'));
  if (failBypassLines.length) {
    console.error('Harness orchestration SSOT check: FAILED.');
    console.error('Task failed status must be set via OrchestrationKernel.failTask / safeFailTask only:');
    console.error(failBypassLines.join('\n'));
    process.exit(1);
  }

  execSync(
    `pnpm vitest run ${ssotVitestFiles.map((f) => JSON.stringify(f)).join(' ')}`,
    { cwd: repoRoot, stdio: 'inherit' },
  );
  console.log('Harness orchestration SSOT check: OK.');
} catch {
  console.error('Harness orchestration SSOT check: FAILED.');
  process.exit(1);
}
