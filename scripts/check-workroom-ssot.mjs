#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitGrepSource } from './lib/git-grep-source.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbidden = [
  'AgentOrchestrator',
  'OrchestratorSkill',
  'buildOrchestratorSkillsCatalog',
  'orchestrator/',
  'OrchestrationService',
  'AgentDispatcher',
  'MemoryOrchestrationRepository',
  'DatabaseOrchestrationRepository',
  'repositoryHandle',
  'dispatcherHandle',
];
const forbiddenModelControlNames = [
  'workroom_transition',
  'workroom_claim_task',
  'workroom_advance_clock',
  'workroom_accept_task',
  'workroom_lease_recovery',
  'workroom_projector_apply',
];
const legacyDataSurfaceNames = [
  'orchestration_runs',
  'orchestration_tasks',
  'orchestration_events',
];

let failed = false;
const authoritySourcePaths = [
  'packages/im/agent/src',
  'basic/cli/src/plugin-runtime',
];

function findAuthorityMatches(pattern, excludeGlobs = []) {
  return gitGrepSource({
    repoRoot,
    pattern,
    paths: authoritySourcePaths,
    excludeGlobs: ['**/lib/**', ...excludeGlobs],
  });
}

for (const pattern of forbidden) {
  const output = findAuthorityMatches(pattern);
  if (output) {
    console.error(`[check:workroom-ssot] forbidden parallel authority "${pattern}":\n${output}`);
    failed = true;
  }
}

for (const pattern of forbiddenModelControlNames) {
  const output = findAuthorityMatches(pattern, [
    // This module owns the fail-closed namespace filter; it never registers a writer.
    '**/deferred-capability-plan.ts',
  ]);
  if (output) {
    console.error(`[check:workroom-ssot] forbidden model control "${pattern}":\n${output}`);
    failed = true;
  }
}

for (const pattern of legacyDataSurfaceNames) {
  const output = findAuthorityMatches(pattern, ['**/legacy-run-offline-migration.ts']);
  if (output) {
    console.error(`[check:workroom-ssot] legacy data surface escaped offline reader "${pattern}":\n${output}`);
    failed = true;
  }
}

const legacyOfflineSource = readFileSync(
  path.join(repoRoot, 'packages/im/agent/src/workroom/legacy-run-offline-migration.ts'),
  'utf8',
);
for (const pattern of [
  'workroom-kernel',
  'agent-host',
  'agent-core',
  'journal.js',
]) {
  if (legacyOfflineSource.includes(pattern)) {
    console.error(`[check:workroom-ssot] offline legacy reader imports runtime authority "${pattern}"`);
    failed = true;
  }
}

const legacyPayloadScannerSource = readFileSync(
  path.join(repoRoot, 'packages/im/agent/src/workroom/legacy-embedded-payload-migration.ts'),
  'utf8',
);
for (const pattern of [
  'workroom-kernel',
  'agent-host',
  'agent-core',
  "from './journal.js'",
  'writeFile',
  'appendFile',
  'unlink',
  'rm(',
  'console.',
]) {
  if (legacyPayloadScannerSource.includes(pattern)) {
    console.error(`[check:workroom-ssot] legacy payload scanner acquired writer/runtime authority "${pattern}"`);
    failed = true;
  }
}

if (failed) process.exit(1);
execFileSync('pnpm', [
  'exec', 'vitest', 'run',
  'packages/im/agent/tests/workroom/workroom-kernel.test.ts',
  'packages/im/agent/tests/workroom/plan-revision-kernel.test.ts',
  'packages/im/agent/tests/workroom/workroom-preemption-kernel.test.ts',
  'packages/im/agent/tests/plugin-runtime/workroom-priority-preemption-production.test.ts',
  'packages/im/agent/tests/workroom/role-capability-snapshot.test.ts',
  'packages/im/agent/tests/workroom/assignment-observation-ingress.test.ts',
  'packages/im/agent/tests/workroom/remote-callback-assignment-ingress.test.ts',
  'packages/im/agent/tests/workroom/accepted-source-memory-application.test.ts',
  'packages/im/agent/tests/workroom/project-knowledge-registry.test.ts',
  'packages/im/agent/tests/workroom/database-project-knowledge-journal.test.ts',
  'packages/im/agent/tests/workroom/profile-assignment-knowledge.e2e.test.ts',
  'packages/im/agent/tests/plugin-runtime/workroom-overlay-pack-promotion.test.ts',
  'packages/im/agent/tests/plugin-runtime/database-overlay-pack-promotion-repository.test.ts',
  'packages/im/agent/tests/plugin-runtime/deferred-capability-plan.test.ts',
  'packages/im/agent/tests/plugin-runtime/workroom-reviewer-authority-runtime.test.ts',
  'packages/im/agent/tests/plugin-runtime/workroom-acceptance-provider-composition.test.ts',
  'packages/im/agent/tests/plugin-runtime/workroom-acceptance-production-composition.test.ts',
  'packages/im/agent/tests/plugin-runtime/workroom-host-local-agent-execution.e2e.test.ts',
  'packages/im/agent/tests/workroom/legacy-run-offline-migration.test.ts',
  'basic/cli/tests/agent-legacy-runs.test.ts',
  'packages/im/agent/tests/workroom/legacy-embedded-payload-migration.test.ts',
  'basic/cli/tests/agent-legacy-payloads.test.ts',
], { cwd: repoRoot, stdio: 'inherit' });
console.log('[check:workroom-ssot] OK — Journal + CAS Kernel is the sole Workroom authority');
