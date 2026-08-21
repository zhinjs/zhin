import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createGenerationOwnedDynamicPlanningProvider,
  createWorkroomDynamicPlanningPolicyAuthority,
  createWorkroomDynamicPlanningPolicySnapshot,
  createWorkroomDynamicPlanningGenerationSnapshot,
  createWorkroomPlanningDisclosure,
  createWorkroomPlanningDisclosureSourceBinding,
  type WorkroomDynamicPlanningPolicyRequest,
} from '../../src/plugin-runtime/workroom-dynamic-planning-provider.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import type { HumanIngressPlanningInput } from '../../src/workroom/human-ingress-orchestrator.js';
import { createWorkroomSchedulerPolicySnapshot } from '../../src/workroom/workroom-scheduler.js';

const definition = Object.freeze({
  name: 'Engineering',
  members: Object.freeze([
    Object.freeze({ agent: 'lead', role: 'orchestrator' as const }),
    Object.freeze({ agent: 'dev', role: 'executor' as const }),
  ]),
  conversation: Object.freeze({
    adapter: 'slack', endpoint: 'bot', kind: 'channel' as const, id: 'C1', agent: 'lead',
  }),
});

const source = Object.freeze({
  ref: 'conversation-event:m1',
  digest: `sha256:${'1'.repeat(64)}`,
  sequence: 7,
  conversationKey: 'slack:bot:channel:C1',
  eventId: 'm1',
  text: '/work secret raw request',
  event: Object.freeze({ timestamp: 100 }) as never,
});

const input: HumanIngressPlanningInput = Object.freeze({
  version: 1,
  operationId: 'human-ingress-application:p1',
  projectId: 'project-1',
  projectRevision: `sha256:${'2'.repeat(64)}`,
  projectDigest: digest(definition),
  orchestratorAgentDefinitionId: 'lead',
  orchestratorAuthorityDigest: `sha256:${'3'.repeat(64)}`,
  principalId: 'human:owner',
  source,
});

const handle = Object.freeze({
  version: 1 as const,
  vaultObjectId: 'vault:1',
  objectId: 'message:m1',
  payloadHash: `sha256:${'4'.repeat(64)}`,
  descriptorDigest: `sha256:${'5'.repeat(64)}`,
  tenantId: 'tenant-1',
  projectId: 'project-1',
  locationManifestDigest: `sha256:${'6'.repeat(64)}`,
});

const disclosedText = '/work disclosed minimum request';
const disclosedHash = `sha256:${createHash('sha256').update(disclosedText).digest('hex')}`;
const disclosedHandle = Object.freeze({ ...handle, payloadHash: disclosedHash });
const manifestProjection = Object.freeze({
    version: 1,
    requestDigest: `sha256:${'8'.repeat(64)}`,
    source: Object.freeze({
      objectId: handle.objectId,
      payloadHash: handle.payloadHash,
      descriptorDigest: handle.descriptorDigest,
      handle,
    }),
    output: Object.freeze({
      handle: disclosedHandle,
      payloadHash: disclosedHash,
      mode: 'full',
      subjectLinked: true,
    }),
    channel: 'model_provider',
    purpose: 'orchestration',
    principal: Object.freeze({ principalId: 'human:owner' }),
    destination: Object.freeze({
      id: 'model:provider-a',
      contractDigest: `sha256:${'9'.repeat(64)}`,
      recipientRevision: 1,
      recipientDigest: `sha256:${'a'.repeat(64)}`,
      loggingMode: 'metadata_only',
      allowsRedisclosure: false,
      supportsDeletion: true,
    }),
    policy: Object.freeze({ revision: 1, digest: `sha256:${'b'.repeat(64)}` }),
    approvalIds: Object.freeze([]),
    expiresAt: 10_000,
});
const manifestDigest = digest(manifestProjection);
const disclosureManifest = Object.freeze({
    ...manifestProjection,
    id: `disclosure-manifest:${manifestDigest}`,
    digest: manifestDigest,
});
const disclosure = createWorkroomPlanningDisclosure({
  source: createWorkroomPlanningDisclosureSourceBinding(input.source),
  text: disclosedText,
  manifest: disclosureManifest,
});

const registry = Object.freeze({
  projectId: 'project-1',
  registryRevision: 2,
  active: Object.freeze({
    revisionId: 'profile-r1',
    compiledDigest: `sha256:${'c'.repeat(64)}`,
    activatedAtRegistryRevision: 2,
  }),
  revisions: Object.freeze({
    'profile-r1': Object.freeze({
      revisionId: 'profile-r1',
      projectId: 'project-1',
      compiledDigest: `sha256:${'c'.repeat(64)}`,
      compiledProfile: Object.freeze({
        revisionId: 'profile-r1',
        projectId: 'project-1',
        digest: `sha256:${'c'.repeat(64)}`,
        tools: Object.freeze([{ id: 'tool:repo', digest: `sha256:${'d'.repeat(64)}` }]),
        skills: Object.freeze([{ id: 'skill:code', digest: `sha256:${'e'.repeat(64)}`, requiresTools: ['tool:repo'] }]),
        agents: Object.freeze([
          { id: 'lead', digest: `sha256:${'f'.repeat(64)}`, role: 'architect', allowedTools: ['tool:repo'], allowedSkills: ['skill:code'] },
          { id: 'dev', digest: `sha256:${'0'.repeat(64)}`, role: 'developer', allowedTools: ['tool:repo'], allowedSkills: ['skill:code'] },
        ]),
        workflows: Object.freeze([{
          id: 'strategy:delivery', digest: `sha256:${'a'.repeat(64)}`, requiredByProfile: true,
          tasks: Object.freeze([]),
        }]),
        charterRevisionId: 'charter-1',
        packRefs: Object.freeze([]),
      }),
    }),
  }),
  runPins: Object.freeze({}),
});

const planningPolicy = createWorkroomDynamicPlanningPolicySnapshot({
  revisionId: 'planning-policy-r7',
  maxTasks: 8,
  maxTotalAttempts: 16,
  maxAttemptsPerTask: 3,
  allowOptionalTasks: true,
  approvalRequiredAuthorities: Object.freeze(['repo:write']),
  sponsorGate: Object.freeze({ owner: 'project-sponsor', decisionTimeoutMs: 60_000 }),
  schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
    policyRef: 'scheduler-policy:project-1', revision: 2, pinnedAtSequence: 1,
    capacity: 2, agingStepMs: 10_000,
    starvationBoundMs: { urgent: 60_000, high: 120_000, normal: 240_000, low: 480_000 },
    preemptionDeadlineMs: 5_000,
  }),
  defaultSponsorLane: 'high' as const,
  defaultTaskDeadlineMs: 3_600_000,
  defaultPreemptibility: 'atomic' as const,
});

function policyPort() {
  return Object.freeze({
    resolve: vi.fn(async (request: WorkroomDynamicPlanningPolicyRequest) =>
      createWorkroomDynamicPlanningPolicyAuthority({
      version: 1,
      generation: request.generation,
      projectId: request.projectId,
      catalogRevision: request.catalogRevision,
      projectDigest: request.projectDigest,
      profileRevisionId: request.profile.revisionId,
      profileDigest: request.profile.digest,
      policy: planningPolicy,
      })),
  });
}

describe('generation-owned dynamic planning provider', () => {
  it('reads exact Catalog/Profile authority and sends only P12-disclosed text to the model', async () => {
    const materialize = vi.fn(async () => disclosure);
    const generate = vi.fn(async modelInput => ({
      version: 1,
      strategy: { id: 'strategy:delivery', version: 'profile-r1', digest: `sha256:${'a'.repeat(64)}` },
      tasks: [{
        key: 'implement', title: 'Implement', role: 'developer', required: true,
        maxAttempts: 2, localRank: 10, dependsOn: [], approval: 'none',
        requires: { tools: ['tool:repo'], skills: ['skill:code'], integrations: [], authorities: [] },
      }],
    }));
    const provider = createGenerationOwnedDynamicPlanningProvider({
      generation: createWorkroomDynamicPlanningGenerationSnapshot(4),
      profiles: { read: vi.fn(async () => registry as never) },
      catalog: { read: vi.fn(async () => ({
        revision: input.projectRevision,
        definitions: { 'project-1': definition },
      })) },
      resolvePolicy: () => policyPort(),
      resolveDisclosure: () => ({ materialize }),
      model: { generate },
      signal: new AbortController().signal,
    });

    const plan = await provider.propose(input);

    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]).toMatchObject({
      scheduler: { sponsorLane: 'high', preemptibility: 'atomic', deadline: 3_600_100 },
    });
    expect(plan.schedulerPolicy).toEqual(planningPolicy.schedulerPolicy);
    expect(plan.authority).toMatchObject({
      projectRevision: input.projectRevision,
      profileRevisionId: 'profile-r1',
      orchestratorAgentDefinitionId: 'lead',
    });
    expect(materialize).toHaveBeenCalledWith(expect.objectContaining({
      generation: expect.objectContaining({ generation: 4 }),
      input,
      destinationKind: 'model_provider',
      purpose: 'orchestration',
    }), expect.any(AbortSignal));
    const modelValue = generate.mock.calls[0]![0];
    expect(modelValue.prompt.objective).toBe(disclosure.text);
    expect(modelValue.prompt.disclosure).toEqual({
      manifestId: disclosure.manifest.id,
      manifestDigest: disclosure.manifest.digest,
      expiresAt: disclosure.manifest.expiresAt,
    });
    expect(JSON.stringify(modelValue.prompt)).not.toContain(source.text);
    expect(modelValue.prompt).not.toHaveProperty('projectId');
    expect(modelValue.prompt).not.toHaveProperty('principalId');
    expect(modelValue.prompt).not.toHaveProperty('sponsorLane');
    expect(modelValue.prompt).not.toHaveProperty('deadline');
    expect(modelValue.binding).toEqual({ agentDefinitionId: 'lead', generation: 4 });
  });

  it('fails closed before model invocation when P12 disclosure authority is absent', async () => {
    const generate = vi.fn();
    const provider = createGenerationOwnedDynamicPlanningProvider({
      generation: createWorkroomDynamicPlanningGenerationSnapshot(1),
      profiles: { read: vi.fn(async () => registry as never) },
      catalog: { read: vi.fn(async () => ({
        revision: input.projectRevision,
        definitions: { 'project-1': definition },
      })) },
      resolvePolicy: () => policyPort(),
      resolveDisclosure: () => undefined,
      model: { generate },
      signal: new AbortController().signal,
    });

    await expect(provider.propose(input)).rejects.toMatchObject({
      name: 'WorkroomPlanningClarificationError',
      reason: 'planning_disclosure_unavailable',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects a stale persistent Catalog/Profile join without asking the model', async () => {
    const generate = vi.fn();
    const provider = createGenerationOwnedDynamicPlanningProvider({
      generation: createWorkroomDynamicPlanningGenerationSnapshot(1),
      profiles: { read: vi.fn(async () => registry as never) },
      catalog: { read: vi.fn(async () => ({
        revision: 'stale-revision',
        definitions: { 'project-1': definition },
      })) },
      resolvePolicy: () => policyPort(),
      resolveDisclosure: () => ({ materialize: async () => disclosure }),
      model: { generate },
      signal: new AbortController().signal,
    });

    await expect(provider.propose(input)).rejects.toMatchObject({
      reason: 'planning_unavailable',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('fails closed when no persistent Project/Profile planning policy projection exists', async () => {
    const generate = vi.fn();
    const materialize = vi.fn();
    const provider = createGenerationOwnedDynamicPlanningProvider({
      generation: createWorkroomDynamicPlanningGenerationSnapshot(1),
      profiles: { read: vi.fn(async () => registry as never) },
      catalog: { read: vi.fn(async () => ({
        revision: input.projectRevision,
        definitions: { 'project-1': definition },
      })) },
      resolvePolicy: () => undefined,
      resolveDisclosure: () => ({ materialize }),
      model: { generate },
      signal: new AbortController().signal,
    });

    await expect(provider.propose(input)).rejects.toMatchObject({ reason: 'planning_unavailable' });
    expect(materialize).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects a policy whose digest does not cover the persisted planning content', async () => {
    const generate = vi.fn();
    const provider = createGenerationOwnedDynamicPlanningProvider({
      generation: createWorkroomDynamicPlanningGenerationSnapshot(1),
      profiles: { read: vi.fn(async () => registry as never) },
      catalog: { read: vi.fn(async () => ({
        revision: input.projectRevision,
        definitions: { 'project-1': definition },
      })) },
      resolvePolicy: () => ({
        resolve: async request => ({
          ...createWorkroomDynamicPlanningPolicyAuthority({
            version: 1,
            generation: request.generation,
            projectId: request.projectId,
            catalogRevision: request.catalogRevision,
            projectDigest: request.projectDigest,
            profileRevisionId: request.profile.revisionId,
            profileDigest: request.profile.digest,
            policy: planningPolicy,
          }),
          policy: { ...planningPolicy, maxTasks: planningPolicy.maxTasks + 1 },
        }),
      }),
      resolveDisclosure: () => ({ materialize: async () => disclosure }),
      model: { generate },
      signal: new AbortController().signal,
    });

    await expect(provider.propose(input)).rejects.toThrow('digest does not cover');
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects a same-Project Manifest lineage bound to another canonical source event', async () => {
    const generate = vi.fn();
    const wrongSourceDisclosure = createWorkroomPlanningDisclosure({
      source: createWorkroomPlanningDisclosureSourceBinding({
        ...input.source,
        ref: 'conversation-event:other-message',
        digest: `sha256:${'f'.repeat(64)}`,
        sequence: input.source.sequence + 1,
        conversationKey: 'slack:bot:channel:OTHER',
      }),
      manifest: disclosureManifest,
      text: disclosedText,
    });
    const provider = createGenerationOwnedDynamicPlanningProvider({
      generation: createWorkroomDynamicPlanningGenerationSnapshot(1),
      profiles: { read: vi.fn(async () => registry as never) },
      catalog: { read: vi.fn(async () => ({
        revision: input.projectRevision,
        definitions: { 'project-1': definition },
      })) },
      resolvePolicy: () => policyPort(),
      resolveDisclosure: () => ({ materialize: async () => wrongSourceDisclosure }),
      model: { generate },
      signal: new AbortController().signal,
    });

    await expect(provider.propose(input)).rejects.toThrow('another canonical source event');
    expect(generate).not.toHaveBeenCalled();
  });
});
