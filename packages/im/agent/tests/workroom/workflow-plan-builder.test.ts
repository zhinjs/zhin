import { describe, expect, it } from 'vitest';
import { WorkflowPlanBuilder } from '../../src/workroom/workflow-plan-builder.js';
import { createWorkroomSchedulerPolicySnapshot } from '../../src/workroom/workroom-scheduler.js';

const scheduler = (localRank = 10) => ({
  sponsorLane: 'normal' as const, localRank, enqueuedAt: 100, deadline: 1_000,
  preemptibility: 'checkpointable' as const,
});

const metadata = (proposalId: string, strategyId: string) => ({
  proposalId,
  projectId: 'project-1',
  strategy: { id: strategyId, version: '1.0.0', digest: `sha256:${'1'.repeat(64)}` },
  parameterDigest: `sha256:${'2'.repeat(64)}`,
  authority: {
    projectRevision: 'catalog-1', projectDigest: `sha256:${'3'.repeat(64)}`,
    profileRevisionId: 'profile-1', profileDigest: `sha256:${'4'.repeat(64)}`,
    planningPolicyRevisionId: 'policy-1', planningPolicyDigest: `sha256:${'5'.repeat(64)}`,
    orchestratorAgentDefinitionId: 'orchestrator-1', orchestratorAuthorityDigest: `sha256:${'6'.repeat(64)}`,
  },
  budget: { maxTasks: 8, maxTotalAttempts: 12 },
  schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
    policyRef: 'scheduler-policy:test', revision: 1, pinnedAtSequence: 1,
    capacity: 2, agingStepMs: 100,
    starvationBoundMs: { urgent: 100, high: 200, normal: 300, low: 400 },
    preemptionDeadlineMs: 50,
  }),
});

describe('WorkflowPlanBuilder', () => {
  it('builds a deterministic immutable Plan proposal without mutating prior builders', () => {
    const base = WorkflowPlanBuilder.create(metadata('proposal-1', 'strategy:software-change'));
    const withBuild = base.addTask({
      key: 'build', title: 'Implement change', role: 'developer', required: true, maxAttempts: 2,
      dependsOn: ['research'],
      requires: { tools: ['tool:test', 'tool:repo'], skills: ['skill:implementation'] },
      scheduler: scheduler(20),
    });
    const complete = withBuild.addTask({
      key: 'research', title: 'Inspect constraints', role: 'architect', required: true, maxAttempts: 1,
      dependsOn: [], requires: { tools: ['tool:repo'], skills: ['skill:architecture'] },
      scheduler: scheduler(10),
    });
    const reordered = base
      .addTask({
        key: 'research', title: 'Inspect constraints', role: 'architect', required: true, maxAttempts: 1,
        dependsOn: [], requires: { skills: ['skill:architecture'], tools: ['tool:repo'] },
        scheduler: scheduler(10),
      })
      .addTask({
        key: 'build', title: 'Implement change', role: 'developer', required: true, maxAttempts: 2,
        dependsOn: ['research'],
        requires: { skills: ['skill:implementation'], tools: ['tool:repo', 'tool:test'] },
        scheduler: scheduler(20),
      });

    expect(() => base.build()).toThrow('at least one Task');
    expect(() => withBuild.build()).toThrow('unknown dependency');
    expect(complete.build()).toEqual(reordered.build());
    expect(complete.build()).toMatchObject({
      version: 1,
      proposalId: 'proposal-1',
      projectId: 'project-1',
      tasks: [{ key: 'build' }, { key: 'research' }],
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(Object.isFrozen(complete.build().tasks[0]?.requires.tools)).toBe(true);
  });

  it('rejects cycles, duplicate task identity and malformed typed requirements', () => {
    const builder = WorkflowPlanBuilder.create(metadata('proposal-1', 'strategy:content'))
      .addTask({
        key: 'draft', title: 'Draft', role: 'writer', required: true, maxAttempts: 1,
        dependsOn: ['edit'], requires: { skills: ['skill:writing'] },
        scheduler: scheduler(),
      })
      .addTask({
        key: 'edit', title: 'Edit', role: 'editor', required: true, maxAttempts: 1,
        dependsOn: ['draft'], requires: { skills: ['skill:editing'] },
        scheduler: scheduler(),
      });

    expect(() => builder.build()).toThrow('cycle');
    expect(() => builder.addTask({
      key: 'draft', title: 'Other', role: 'writer', required: true, maxAttempts: 1,
      dependsOn: [], requires: {},
      scheduler: scheduler(),
    })).toThrow('already exists');
    expect(() => WorkflowPlanBuilder.create(metadata('proposal-2', 'strategy:bad')).addTask({
      key: 'publish', title: 'Publish', role: 'integration', required: true, maxAttempts: 1,
      dependsOn: [], requires: { authorities: [''] },
      scheduler: scheduler(),
    })).toThrow('non-empty');
  });

  it('rejects a non-boolean required flag at the public runtime boundary', () => {
    const builder = WorkflowPlanBuilder.create(metadata('proposal-runtime-validation', 'strategy:runtime'));

    expect(() => builder.addTask({
      key: 'optional',
      title: 'Optional task',
      role: 'worker',
      required: 'false' as unknown as boolean,
      maxAttempts: 1,
      dependsOn: [],
      requires: {},
      scheduler: scheduler(),
    })).toThrow('required must be a boolean');
  });

  it('requires at least one required Task so optional work cannot define Run success by itself', () => {
    const builder = WorkflowPlanBuilder.create(metadata('proposal-only-optional', 'strategy:optional'))
      .addTask({
        key: 'nice-to-have', title: 'Optional polish', role: 'worker', required: false,
        maxAttempts: 1, dependsOn: [], requires: {},
        scheduler: scheduler(),
      });

    expect(() => builder.build()).toThrow('at least one required Task');
  });
});
