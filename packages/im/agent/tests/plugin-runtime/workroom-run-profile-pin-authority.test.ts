import { describe, expect, it, vi } from 'vitest';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';
import { WorkflowPlanBuilder } from '../../src/workroom/workflow-plan-builder.js';
import { createWorkroomSchedulerPolicySnapshot } from '../../src/workroom/workroom-scheduler.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import {
  JournalWorkroomRunProfilePinAuthority,
  KernelPlanAdmissionRunProfilePinWriter,
  WORKROOM_KERNEL_PLAN_ADMISSION_PRINCIPAL,
} from '../../src/plugin-runtime/workroom-run-profile-pin-authority.js';

const SHA = `sha256:${'a'.repeat(64)}`;

describe('Kernel Plan admission Run Profile pin authority', () => {
  it('signs only the exact persisted Run/Plan fact and the writer replays immutable pin CAS', async () => {
    const journal = new MemoryWorkroomJournal();
    let eventId = 0;
    const kernel = new WorkroomKernel({ journal, now: () => 10, createId: () => `event-${++eventId}` });
    const plan = planFixture();
    const receipt = await kernel.admitWorkflowPlan({
      operationId: plan.proposalId, projectId: plan.projectId, title: 'Build',
      sourceEventRef: 'conversation:1', sourceEventDigest: SHA,
      orchestratorAgentDefinitionId: 'orchestrator-1', plan,
    });
    const authority = new JournalWorkroomRunProfilePinAuthority({ generation: 3, journal });
    const pin = {
      projectId: 'project-1', runId: receipt.runId, profileRevisionId: 'profile-1',
      profileDigest: SHA, activationRegistryRevision: 1, pinnedAtRegistryRevision: 2,
    };
    const pins = { pin: vi.fn(async () => pin) };
    const writer = new KernelPlanAdmissionRunProfilePinWriter({
      authority,
      profiles: { read: async () => ({
        registryRevision: 1,
        active: { revisionId: 'profile-1', compiledDigest: SHA, activatedAtRegistryRevision: 1 },
      }) as never },
      runPins: pins,
    });
    await writer.afterPlanAdmission({ operationId: plan.proposalId, projectId: plan.projectId, plan, receipt },
      new AbortController().signal);
    await writer.afterPlanAdmission({ operationId: plan.proposalId, projectId: plan.projectId, plan, receipt },
      new AbortController().signal);
    expect(pins.pin).toHaveBeenCalledTimes(2);
    const command = pins.pin.mock.calls[0]![0];
    expect(command).toMatchObject({
      principalId: WORKROOM_KERNEL_PLAN_ADMISSION_PRINCIPAL,
      projectId: 'project-1', runId: receipt.runId,
      planRevisionId: plan.proposalId, planDigest: plan.digest,
      profileRevisionId: 'profile-1', profileDigest: SHA,
    });
    expect(await authority.authorize({ ...command, generation: 3, digest: digestRequest(command, 3) }))
      .toMatchObject({ requestDigest: digestRequest(command, 3) });
    expect(await authority.authorize({
      ...command, planDigest: `sha256:${'b'.repeat(64)}`, generation: 3,
      digest: digestRequest({ ...command, planDigest: `sha256:${'b'.repeat(64)}` }, 3),
    })).toBeUndefined();

    const drifted = new KernelPlanAdmissionRunProfilePinWriter({
      authority,
      profiles: { read: async () => ({
        registryRevision: 2,
        active: {
          revisionId: 'profile-2', compiledDigest: `sha256:${'c'.repeat(64)}`,
          activatedAtRegistryRevision: 2,
        },
      }) as never },
      runPins: pins,
    });
    await expect(drifted.afterPlanAdmission({
      operationId: plan.proposalId, projectId: plan.projectId, plan, receipt,
    }, new AbortController().signal)).rejects.toThrow('no longer the active pin candidate');
    expect(pins.pin).toHaveBeenCalledTimes(2);
  });
});

function planFixture() {
  return WorkflowPlanBuilder.create({
    proposalId: 'operation-1', projectId: 'project-1', parameterDigest: SHA,
    strategy: { id: 'strategy-1', version: '1', digest: SHA },
    authority: {
      projectRevision: 'catalog-1', projectDigest: SHA,
      profileRevisionId: 'profile-1', profileDigest: SHA,
      planningPolicyRevisionId: 'policy-1', planningPolicyDigest: SHA,
      orchestratorAgentDefinitionId: 'orchestrator-1', orchestratorAuthorityDigest: SHA,
    },
    budget: { maxTasks: 1, maxTotalAttempts: 1 },
    schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
      policyRef: 'scheduler:1', revision: 1, pinnedAtSequence: 1, capacity: 1,
      agingStepMs: 100, starvationBoundMs: {
        urgent: 100, high: 200, normal: 300, low: 400,
      }, preemptionDeadlineMs: 500,
    }),
  }).addTask({
    key: 'build', title: 'Build', role: 'executor', required: true, maxAttempts: 1,
    dependsOn: [], requires: {},
    scheduler: { sponsorLane: 'normal', localRank: 1, deadline: 100, enqueuedAt: 1, preemptibility: 'atomic' },
  }).build();
}

function digestRequest(command: object, generation: number): string {
  return digest({ ...command, generation });
}
