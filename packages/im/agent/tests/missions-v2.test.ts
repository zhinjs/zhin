/**
 * missions — manifest gate, ACL, remote validator, auto spec dry-run.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import {
  initOrchestrationService,
  MISSIONS_TEMPLATE,
} from '../src/orchestrator/orchestration-service.js';
import { getAgentDispatcher } from '../src/orchestrator/agent-dispatcher.js';
import {
  setValidationSpecRunnerForTests,
  resetValidationSpecRunner,
} from '../src/builtin/run-validation-spec-tool.js';
import { validateMissionStatePatch } from '../src/orchestrator/mission-patch-acl.js';
import {
  validateMissionManifest,
  validateMissionSpecBundle,
} from '../src/orchestrator/mission-spec.js';
import { MissionRunner } from '../src/orchestrator/mission-runner.js';
import type { SubagentManager } from '../src/subagent.js';

describe('missions', () => {
  beforeEach(() => {
    resetValidationSpecRunner();
  });

  it('startRun creates DAG with remote Validate executor', async () => {
    const repo = new MemoryOrchestrationRepository();
    const svc = initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);

    const snapshot = await svc.startRun({
      sessionKey: 'sandbox:bot:private:user1',
      template: MISSIONS_TEMPLATE,
      remoteValidator: 'lab-validator',
    });

    expect(snapshot.run.template).toBe(MISSIONS_TEMPLATE);
    const validate = snapshot.tasks.find((t) => t.phase === 'validate');
    expect(validate?.executor_kind).toBe('remote');
    expect(validate?.remote_agent_id).toBe('lab-validator');

    const state = await svc.getMissionState(snapshot.run.id);
    expect(state?.remote_validator_id).toBe('lab-validator');
  });

  it('validateMissionManifest rejects empty and duplicate ids', () => {
    expect(validateMissionManifest({ assertions: [] }).ok).toBe(false);
    expect(validateMissionManifest({
      assertions: [{ id: 'a' }, { id: 'a' }],
    }).ok).toBe(false);
    expect(validateMissionManifest({
      assertions: [{ id: 'a1' }, { id: 'a2' }],
    }).ok).toBe(true);
  });

  it('patch ACL blocks develop-phase writes to validation_spec_paths', () => {
    const check = validateMissionStatePatch('develop', {
      validation_spec_paths: ['x.test.ts'],
    });
    expect(check.ok).toBe(false);
  });

  it('MissionRunner auto spec gate sets spec_dry_run_passed on success', async () => {
    setValidationSpecRunnerForTests(async () => ({
      ok: true,
      stdout: '2 passed',
      stderr: '',
    }));

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-mission-'));
    const runId = 'abc12345';
    const specDir = path.join(tmp, '.zhin', 'missions', runId);
    await fs.mkdir(specDir, { recursive: true });
    const specPath = path.join(specDir, 'spec.test.ts');
    const manifestPath = path.join(specDir, 'manifest.json');
    await fs.writeFile(specPath, 'import { it, expect } from "vitest"; it("x", () => expect(1).toBe(1));');
    await fs.writeFile(manifestPath, JSON.stringify({ assertions: [{ id: 'x' }] }));

    const bundle = await validateMissionSpecBundle(
      runId,
      [specPath, manifestPath],
      true,
      tmp,
    );
    expect(bundle.ok).toBe(true);
    expect(bundle.assertionCount).toBe(1);

    const repo = new MemoryOrchestrationRepository();
    const svc = initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);

    const snapshot = await svc.startRun({
      sessionKey: 'sandbox:bot:private:user1',
      template: MISSIONS_TEMPLATE,
    });
    await svc.patchMissionState(snapshot.run.id, {
      validation_spec_paths: [specPath, manifestPath],
    }, { skipAcl: true });

    const runner = new MissionRunner({
      subagentManager: { spawn: vi.fn() } as unknown as SubagentManager,
      resolveSessionContext: () => null,
    });

    const ok = await runner['tryAutoSpecGate'](snapshot.run.id);
    expect(ok).toBe(true);

    const state = await svc.getMissionState(snapshot.run.id);
    expect(state?.spec_dry_run_passed).toBe(true);
    expect(state?.assertion_count).toBe(1);
  });
});
