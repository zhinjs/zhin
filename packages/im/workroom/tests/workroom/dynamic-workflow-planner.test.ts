import { describe, expect, it, vi } from 'vitest';
import {
  DynamicWorkflowPlanningPort,
  type DynamicWorkflowPlanningAuthority,
} from '../../src/workroom/dynamic-workflow-planner.js';
import type { HumanIngressPlanningInput } from '../../src/workroom/human-ingress-orchestrator.js';
import { createWorkroomSchedulerPolicySnapshot } from '../../src/workroom/workroom-scheduler.js';

const source = Object.freeze({
  ref: 'conversation-event:message-1',
  digest: `sha256:${'1'.repeat(64)}`,
  sequence: 7,
  conversationKey: 'adapter:bot:group:group-1',
  eventId: 'message-1',
  text: '/work ship the release',
  event: Object.freeze({ timestamp: 100 }) as never,
});

const input: HumanIngressPlanningInput = Object.freeze({
  version: 1,
  operationId: 'human-ingress-application:proposal-1',
  projectId: 'project-1',
  projectRevision: 'catalog-revision-7',
  projectDigest: `sha256:${'2'.repeat(64)}`,
  orchestratorAgentDefinitionId: 'orchestrator-1',
  orchestratorAuthorityDigest: `sha256:${'3'.repeat(64)}`,
  principalId: 'owner:human-1',
  source,
});

const authority: DynamicWorkflowPlanningAuthority = Object.freeze({
  version: 1,
  projectId: 'project-1',
  projectRevision: 'catalog-revision-7',
  projectDigest: `sha256:${'2'.repeat(64)}`,
  orchestratorAgentDefinitionId: 'orchestrator-1',
  orchestratorAuthorityDigest: `sha256:${'3'.repeat(64)}`,
  profile: Object.freeze({
    revisionId: 'profile-4',
    digest: `sha256:${'4'.repeat(64)}`,
    strategies: Object.freeze([
      Object.freeze({ id: 'strategy:release', version: '2.0.0', digest: `sha256:${'5'.repeat(64)}` }),
    ]),
    roles: Object.freeze(['architect', 'developer', 'reviewer']),
    capabilities: Object.freeze({
      tools: Object.freeze(['tool:ci', 'tool:repo']),
      skills: Object.freeze(['skill:architecture', 'skill:implementation', 'skill:review']),
      integrations: Object.freeze(['integration:github']),
      authorities: Object.freeze(['repo:read', 'repo:write']),
    }),
  }),
  policy: Object.freeze({
    revisionId: 'planning-policy-3',
    digest: `sha256:${'6'.repeat(64)}`,
    maxTasks: 6,
    maxTotalAttempts: 10,
    maxAttemptsPerTask: 3,
    allowOptionalTasks: true,
    approvalRequiredAuthorities: Object.freeze(['repo:write']),
    sponsorGate: Object.freeze({
      owner: 'project-sponsor',
      decisionTimeoutMs: 86_400_000,
    }),
    schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
      policyRef: 'scheduler-policy:project-1', revision: 1, pinnedAtSequence: 1,
      capacity: 3, agingStepMs: 1_000,
      starvationBoundMs: { urgent: 5_000, high: 10_000, normal: 20_000, low: 30_000 },
      preemptionDeadlineMs: 2_000,
    }),
    defaultSponsorLane: 'normal',
    defaultTaskDeadlineMs: 3_600_000,
    defaultPreemptibility: 'checkpointable',
  }),
});

describe('DynamicWorkflowPlanningPort', () => {
  it('turns an untrusted multi-Task DAG into a canonical authority-bound Plan', async () => {
    const propose = vi.fn(async () => ({
      version: 1,
      strategy: { id: 'strategy:release', version: '2.0.0', digest: `sha256:${'5'.repeat(64)}` },
      tasks: [
        {
          key: 'review', title: 'Review the candidate', role: 'reviewer', required: false,
          maxAttempts: 1, localRank: 40, dependsOn: ['build'], approval: 'none',
          requires: { tools: ['tool:repo'], skills: ['skill:review'], integrations: [], authorities: ['repo:read'] },
        },
        {
          key: 'design', title: 'Design the change', role: 'architect', required: true,
          maxAttempts: 1, localRank: 10, dependsOn: [], approval: 'none',
          requires: { tools: ['tool:repo'], skills: ['skill:architecture'], integrations: [], authorities: ['repo:read'] },
        },
        {
          key: 'build', title: 'Build the change', role: 'developer', required: true,
          maxAttempts: 2, localRank: 20, dependsOn: ['design'], approval: 'sponsor_required',
          requires: { tools: ['tool:repo', 'tool:ci'], skills: ['skill:implementation'], integrations: ['integration:github'], authorities: ['repo:write'] },
        },
        {
          key: 'docs', title: 'Prepare release notes', role: 'developer', required: false,
          maxAttempts: 1, localRank: 30, dependsOn: ['design'], approval: 'none',
          requires: { tools: ['tool:repo'], skills: [], integrations: [], authorities: ['repo:read'] },
        },
      ],
    }));
    const planner = new DynamicWorkflowPlanningPort({
      resolveAuthority: async () => authority,
      planner: { propose },
    });

    const plan = await planner.propose(input);

    expect(plan).toMatchObject({
      version: 1,
      proposalId: input.operationId,
      projectId: input.projectId,
      parameterDigest: source.digest,
      strategy: authority.profile.strategies[0],
      authority: {
        projectRevision: input.projectRevision,
        profileRevisionId: authority.profile.revisionId,
        planningPolicyRevisionId: authority.policy.revisionId,
        orchestratorAgentDefinitionId: input.orchestratorAgentDefinitionId,
      },
      budget: { maxTasks: 6, maxTotalAttempts: 10 },
      tasks: [
        {
          key: 'build', dependsOn: ['design'], required: true,
          scheduler: { sponsorLane: 'normal', localRank: 20, enqueuedAt: 100, deadline: 3_600_100 },
          approvalGate: { kind: 'sponsor', owner: 'project-sponsor', deadline: 86_400_100 },
        },
        { key: 'design', dependsOn: [], required: true, scheduler: { sponsorLane: 'normal', localRank: 10 } },
        { key: 'docs', dependsOn: ['design'], required: false },
        { key: 'review', dependsOn: ['build'], required: false },
      ],
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({
      authority,
      source: expect.objectContaining({ ref: source.ref, digest: source.digest, text: source.text }),
    }));
    expect(Object.isFrozen(propose.mock.calls[0]![0])).toBe(true);
  });

  it('rejects budget overflow, cycles, unknown capabilities and missing mandatory approval', async () => {
    const candidate = {
      version: 1,
      strategy: authority.profile.strategies[0],
      tasks: [{
        key: 'write', title: 'Write', role: 'developer', required: true,
        maxAttempts: 2, localRank: 10, dependsOn: [], approval: 'none',
        requires: { tools: ['tool:repo'], skills: [], integrations: [], authorities: ['repo:write'] },
      }],
    };
    const create = (value: unknown, patch: Partial<DynamicWorkflowPlanningAuthority> = {}) =>
      new DynamicWorkflowPlanningPort({
        resolveAuthority: async () => Object.freeze({ ...authority, ...patch }),
        planner: { propose: async () => value },
      });

    await expect(create(candidate).propose(input)).rejects.toThrow('approval');
    await expect(create({ ...candidate, tasks: [
      { ...candidate.tasks[0], key: 'a', dependsOn: ['b'], approval: 'sponsor_required' },
      { ...candidate.tasks[0], key: 'b', dependsOn: ['a'], approval: 'sponsor_required' },
    ] }).propose(input)).rejects.toThrow('cycle');
    await expect(create({ ...candidate, tasks: [
      { ...candidate.tasks[0], requires: { ...candidate.tasks[0].requires, tools: ['tool:root'] }, approval: 'sponsor_required' },
    ] }).propose(input)).rejects.toThrow('Profile');
    await expect(create({ ...candidate, tasks: [
      { ...candidate.tasks[0], maxAttempts: 3, approval: 'sponsor_required' },
      { ...candidate.tasks[0], key: 'write-2', maxAttempts: 3, approval: 'sponsor_required' },
    ] }, {
      policy: Object.freeze({ ...authority.policy, maxTotalAttempts: 5 }),
    }).propose(input)).rejects.toThrow('budget');
  });

  it('rejects planner attempts to forge identity, authority or state fields', async () => {
    const planner = new DynamicWorkflowPlanningPort({
      resolveAuthority: async () => authority,
      planner: { propose: async () => ({
        version: 1,
        projectId: 'other-project',
        strategy: authority.profile.strategies[0],
        tasks: [],
      }) },
    });

    await expect(planner.propose(input)).rejects.toThrow('unexpected field projectId');
  });
});
