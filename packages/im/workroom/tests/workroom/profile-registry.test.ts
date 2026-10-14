import {
  compileWorkroomProfile,
  type CapabilityPack,
  type CompiledWorkroomProfile,
} from '../../src/workroom/profile-compiler.js';
import {
  createProjectProfileGovernanceAuthorizationInput,
  MemoryProjectProfileJournal,
  ProjectProfileRegistry,
  replayProjectProfileJournal,
  type ProfileGovernanceDecision,
  type ProjectProfileGovernanceAuthorizationInput,
  type ProjectProfileGovernancePort,
  type ProjectProfileRevision,
  type ProjectProfileRevisionCandidate,
} from '../../src/workroom/profile-registry.js';

function compiledProfile(
  revisionId: string,
  projectId = 'project-a',
  toolId = 'repo.read',
): CompiledWorkroomProfile {
  const toolDigest = `sha256:${toolId}-v1`;
  const pack: CapabilityPack = {
    id: 'software-domain',
    version: '1.0.0',
    digest: `sha256:software-domain-${toolId}-v1`,
    kind: 'domain',
    tools: [{ id: toolId, digest: toolDigest }],
    skills: [],
    agents: [],
    workflows: [],
  };
  const result = compileWorkroomProfile({
    revision: {
      id: revisionId,
      projectId,
      charterRevisionId: 'charter-7',
      packs: [{ id: pack.id, version: pack.version, digest: pack.digest }],
      enabledTools: [toolId],
      enabledSkills: [],
      enabledAgents: [],
      enabledWorkflows: [],
    },
    packs: [pack],
    generationSupply: {
      tools: [{ id: toolId, digest: toolDigest }],
      skills: [],
      agents: [],
    },
  });
  if (!result.ok) throw new Error('fixture Profile must compile');
  return result.profile;
}

function revision(
  revisionId: string,
  overrides: Partial<ProjectProfileRevisionCandidate> = {},
  toolId = 'repo.read',
): ProjectProfileRevisionCandidate {
  const profile = compiledProfile(revisionId, 'project-a', toolId);
  return {
    revisionId,
    projectId: profile.projectId,
    charterRevisionId: profile.charterRevisionId,
    packRefs: profile.packRefs,
    overlayDigest: 'sha256:project-overlay-v1',
    compiledDigest: profile.digest,
    compiledProfile: profile,
    source: {
      kind: 'acceptance_record',
      sourceId: 'acceptance-17',
    },
    ...overrides,
  };
}

function capabilityRevision(
  revisionId: string,
  parentRevisionId: string,
  options: {
    readonly tools?: readonly string[];
    readonly agents?: readonly string[];
    readonly overlayDigest?: string;
  },
): ProjectProfileRevisionCandidate {
  const toolIds = options.tools ?? ['repo.read'];
  const agentIds = options.agents ?? [];
  const pack: CapabilityPack = {
    id: 'software-domain',
    version: '2.0.0',
    digest: `sha256:software-domain-${[...toolIds, ...agentIds].join('+') || 'empty'}-v2`,
    kind: 'domain',
    tools: toolIds.map(id => ({ id, digest: `sha256:${id}-v1` })),
    skills: [],
    agents: agentIds.map(id => ({
      id,
      digest: `sha256:${id}-v1`,
      role: 'developer',
      allowedTools: [...toolIds],
      allowedSkills: [],
    })),
    workflows: [],
  };
  const result = compileWorkroomProfile({
    revision: {
      id: revisionId,
      projectId: 'project-a',
      charterRevisionId: 'charter-7',
      packs: [{ id: pack.id, version: pack.version, digest: pack.digest }],
      enabledTools: [...toolIds],
      enabledSkills: [],
      enabledAgents: [...agentIds],
      enabledWorkflows: [],
    },
    packs: [pack],
    generationSupply: {
      tools: toolIds.map(id => ({ id, digest: `sha256:${id}-v1` })),
      skills: [],
      agents: agentIds.map(id => ({ id, digest: `sha256:${id}-v1` })),
    },
  });
  if (!result.ok) throw new Error('capability fixture Profile must compile');
  return {
    revisionId,
    projectId: 'project-a',
    charterRevisionId: 'charter-7',
    packRefs: result.profile.packRefs,
    overlayDigest: options.overlayDigest ?? 'sha256:project-overlay-v1',
    compiledDigest: result.profile.digest,
    compiledProfile: result.profile,
    parentRevisionId,
    source: { kind: 'acceptance_record', sourceId: `acceptance-${revisionId}` },
  };
}

function approved(
  input: ProjectProfileGovernanceAuthorizationInput,
  overrides: Partial<ProfileGovernanceDecision> = {},
): ProfileGovernanceDecision {
  return {
    approved: true,
    ...input,
    decisionId: 'profile-policy-17',
    route: input.semanticDiff.bootstrap || input.semanticDiff.authorityExpansion
      ? 'sponsor'
      : 'policy',
    outcome: 'approved',
    decidedBy: input.semanticDiff.bootstrap || input.semanticDiff.authorityExpansion
      ? 'principal:sponsor-1'
      : 'profile-policy:v1',
    ...overrides,
  };
}

const allowingGovernance: ProjectProfileGovernancePort = {
  authorize: async input => approved(input),
};

function createRegistry(journal = new MemoryProjectProfileJournal()): ProjectProfileRegistry {
  return new ProjectProfileRegistry(journal, allowingGovernance);
}

function persistedRevision(
  candidate: ProjectProfileRevisionCandidate,
  expectedRegistryRevision: number,
  currentActive?: ProjectProfileRevision,
): ProjectProfileRevision {
  const input = createProjectProfileGovernanceAuthorizationInput(
    candidate,
    candidate.restoredFromRevisionId ? 'register_rollback' : 'register_revision',
    expectedRegistryRevision,
    currentActive,
  );
  return { ...candidate, governanceDecision: approved(input) };
}

describe('ProjectProfileRegistry', () => {
  it('registers one exact immutable compiled revision and rejects identity payload drift', async () => {
    const registry = createRegistry();
    const registered = await registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: revision('profile-1'),
    });

    expect(registered).toMatchObject({
      projectId: 'project-a',
      registryRevision: 0,
      active: undefined,
      revisions: {
        'profile-1': {
          charterRevisionId: 'charter-7',
          packRefs: [{
            id: 'software-domain',
            version: '1.0.0',
            digest: 'sha256:software-domain-repo.read-v1',
          }],
          overlayDigest: 'sha256:project-overlay-v1',
          source: { kind: 'acceptance_record', sourceId: 'acceptance-17' },
          governanceDecision: {
            decisionId: 'profile-policy-17',
            compiledDigest: revision('profile-1').compiledDigest,
          },
        },
      },
    });
    expect(Object.isFrozen(registered.revisions['profile-1']?.packRefs)).toBe(true);

    const idempotent = await registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: revision('profile-1'),
    });
    expect(idempotent.registryRevision).toBe(0);

    await expect(registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 0,
      revision: revision('profile-1', { overlayDigest: 'sha256:drifted-overlay' }),
    })).rejects.toThrow('Profile Revision profile-1 identity payload drift');
  });

  it('does not accept a caller-asserted Sponsor decision when the trusted governance authority denies it', async () => {
    const forged = {
      ...revision('profile-1'),
      governanceDecision: {
        decisionId: 'forged-sponsor-approval',
        route: 'sponsor',
        outcome: 'approved',
        compiledDigest: revision('profile-1').compiledDigest,
        decidedBy: 'principal:claimed-sponsor',
      },
    };
    const registry = new ProjectProfileRegistry(
      new MemoryProjectProfileJournal(),
      { authorize: async () => ({ approved: false, reason: 'not authorized' }) } as never,
    );

    await expect(registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: forged,
    })).rejects.toThrow('Profile governance denied: not authorized');
  });

  it('fails closed without authority and rejects stale governance scope echoes', async () => {
    await expect(new ProjectProfileRegistry(new MemoryProjectProfileJournal()).registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: revision('profile-1'),
    })).rejects.toThrow('Project Profile Governance Port is not installed');

    const staleDecisions: readonly Partial<ProfileGovernanceDecision>[] = [
      { projectId: 'project-b' },
      { revisionId: 'profile-stale' },
      { compiledDigest: 'sha256:stale-compiled-profile' },
      { overlayDigest: 'sha256:stale-overlay' },
      {
        operation: 'register_rollback',
        restoredFromRevisionId: 'profile-old',
      },
      { source: { kind: 'sponsor_decision', sourceId: 'another-source' } },
    ];
    for (const stale of staleDecisions) {
      const governance: ProjectProfileGovernancePort = {
        authorize: async input => approved(input, stale),
      };
      const registry = new ProjectProfileRegistry(new MemoryProjectProfileJournal(), governance);
      await expect(registry.registerRevision({
        projectId: 'project-a',
        expectedRegistryRevision: -1,
        revision: revision('profile-1'),
      })).rejects.toThrow('Profile governance decision scope mismatch');
    }

    const rollbackGovernance: ProjectProfileGovernancePort = {
      authorize: async input => input.operation === 'register_rollback'
        ? approved(input, { operation: 'register_revision' })
        : approved(input),
    };
    const rollbackRegistry = new ProjectProfileRegistry(
      new MemoryProjectProfileJournal(),
      rollbackGovernance,
    );
    const profile1 = revision('profile-1');
    await rollbackRegistry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: profile1,
    });
    await rollbackRegistry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 0,
      revisionId: profile1.revisionId,
      compiledDigest: profile1.compiledDigest,
    });
    const profile2 = revision('profile-2', { parentRevisionId: 'profile-1' }, 'repo.write');
    await rollbackRegistry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 1,
      revision: profile2,
    });
    await rollbackRegistry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 2,
      revisionId: profile2.revisionId,
      compiledDigest: profile2.compiledDigest,
    });
    await expect(rollbackRegistry.registerRollback({
      projectId: 'project-a',
      expectedRegistryRevision: 3,
      restoredFromRevisionId: 'profile-1',
      revision: revision('profile-3', {
        parentRevisionId: 'profile-2',
        restoredFromRevisionId: 'profile-1',
      }),
    })).rejects.toThrow('Profile governance decision scope mismatch');
  });

  it('requires Sponsor governance for bootstrap and capability or Overlay expansion', async () => {
    const observed = new Map<string, ProjectProfileGovernanceAuthorizationInput>();
    const governance: ProjectProfileGovernancePort = {
      authorize: async input => {
        observed.set(input.revisionId, input);
        return approved(input, {
          route: input.expectedRegistryRevision === -1 || input.revisionId.endsWith('-sponsor')
            ? 'sponsor'
            : 'policy',
        });
      },
    };
    const journal = new MemoryProjectProfileJournal();
    const registry = new ProjectProfileRegistry(journal, governance);
    const initial = revision('profile-1');
    await registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: initial,
    });
    await registry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 0,
      revisionId: initial.revisionId,
      compiledDigest: initial.compiledDigest,
    });

    await expect(registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 1,
      revision: capabilityRevision('tool-policy', 'profile-1', {
        tools: ['repo.read', 'repo.write'],
      }),
    })).rejects.toThrow('Sponsor governance is required');

    expect(observed.get('profile-1')).toMatchObject({
      semanticDiff: { bootstrap: true, authorityExpansion: true },
    });
    expect(observed.get('profile-1')?.currentActive).toBeUndefined();
    expect(observed.get('tool-policy')).toMatchObject({
      currentActive: { revisionId: 'profile-1', compiledDigest: initial.compiledDigest },
      semanticDiff: {
        tool: { added: ['repo.write'], authorityExpansion: true },
        policy: { authorityExpansion: true },
        authorityExpansion: true,
      },
    });
    await expect(registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 1,
      revision: capabilityRevision('agent-policy', 'profile-1', {
        agents: ['software-developer'],
      }),
    })).rejects.toThrow('Sponsor governance is required');
    expect(observed.get('agent-policy')).toMatchObject({
      semanticDiff: {
        agent: { added: ['software-developer'], authorityExpansion: true },
        authorityExpansion: true,
      },
    });
    await expect(registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 1,
      revision: revision('overlay-policy', {
        parentRevisionId: 'profile-1',
        overlayDigest: 'sha256:expanded-overlay',
      }),
    })).rejects.toThrow('Sponsor governance is required');
    expect(observed.get('overlay-policy')).toMatchObject({
      semanticDiff: {
        overlay: { changed: true, authorityExpansion: true },
        authorityExpansion: true,
      },
    });

    const sponsorCandidate = capabilityRevision('tool-sponsor', 'profile-1', {
      tools: ['repo.read', 'repo.write'],
    });
    const sponsored = await registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 1,
      revision: sponsorCandidate,
    });
    expect(sponsored.revisions['tool-sponsor']?.governanceDecision.route).toBe('sponsor');
    await registry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 2,
      revisionId: sponsorCandidate.revisionId,
      compiledDigest: sponsorCandidate.compiledDigest,
    });

    const unchanged = capabilityRevision('unchanged-policy', 'tool-sponsor', {
      tools: ['repo.read', 'repo.write'],
    });
    const policyApproved = await registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 3,
      revision: unchanged,
    });
    expect(policyApproved.revisions['unchanged-policy']?.governanceDecision.route).toBe('policy');
    expect(observed.get('unchanged-policy')?.semanticDiff.authorityExpansion).toBe(false);

    const tampered = (await journal.read('project-a')).map(event => {
      if (event.type !== 'profile.revision_registered'
        || event.payload.revision.revisionId !== 'tool-sponsor') return event;
      return {
        ...event,
        payload: {
          revision: {
            ...event.payload.revision,
            governanceDecision: {
              ...event.payload.revision.governanceDecision,
              route: 'policy' as const,
            },
          },
        },
      };
    });
    expect(() => replayProjectProfileJournal('project-a', tampered))
      .toThrow('Sponsor governance is required');
  });

  it('treats every Acceptance policy semantic change as a conservative authority expansion', () => {
    const activeCandidate = acceptanceRevision('profile-a', 'reviewer_required');
    const active = persistedRevision(activeCandidate, -1);
    const candidate = acceptanceRevision('profile-b', 'baseline', 'profile-a');
    const input = createProjectProfileGovernanceAuthorizationInput(
      candidate,
      'register_revision',
      2,
      active,
    );
    expect(input.semanticDiff).toMatchObject({
      acceptancePolicy: {
        changed: ['software-acceptance'],
        authorityExpansion: true,
      },
      authorityExpansion: true,
    });
  });

  it('snapshots a Revision before awaiting journal IO', async () => {
    const registry = createRegistry();
    const candidate = revision('profile-1');
    const pending = registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: candidate,
    });
    (candidate as { overlayDigest: string }).overlayDigest = 'sha256:mutated-after-call';

    const registered = await pending;
    expect(registered.revisions['profile-1']?.overlayDigest).toBe('sha256:project-overlay-v1');
  });

  it('activates an exact digest through registry CAS without rewriting history', async () => {
    const journal = new MemoryProjectProfileJournal();
    const registry = createRegistry(journal);
    await registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: revision('profile-1'),
    });

    await expect(registry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 0,
      revisionId: 'profile-1',
      compiledDigest: 'sha256:wrong',
    })).rejects.toThrow('compiled digest mismatch');

    const firstActive = await registry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 0,
      revisionId: 'profile-1',
      compiledDigest: revision('profile-1').compiledDigest,
    });
    const original = firstActive.revisions['profile-1'];
    expect(firstActive.active).toEqual({
      revisionId: 'profile-1',
      compiledDigest: revision('profile-1').compiledDigest,
      activatedAtRegistryRevision: 1,
    });

    await registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 1,
      revision: revision('profile-2', { parentRevisionId: 'profile-1' }),
    });
    await expect(registry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 1,
      revisionId: 'profile-2',
      compiledDigest: revision('profile-2').compiledDigest,
    })).rejects.toMatchObject({
      name: 'ProfileRegistrySequenceConflictError',
      expectedRevision: 1,
      actualRevision: 2,
    });

    const secondActive = await registry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 2,
      revisionId: 'profile-2',
      compiledDigest: revision('profile-2').compiledDigest,
    });
    expect(secondActive.active?.revisionId).toBe('profile-2');
    expect(secondActive.revisions['profile-1']).toEqual(original);
    await expect(registry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 3,
      revisionId: 'profile-1',
      compiledDigest: revision('profile-1').compiledDigest,
    })).rejects.toThrow('create a rollback Revision');
  });

  it('rolls back as a governed new revision and keeps every existing Run pin exact', async () => {
    const registry = createRegistry();
    const profile1 = revision('profile-1');
    await registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: profile1,
    });
    await registry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 0,
      revisionId: profile1.revisionId,
      compiledDigest: profile1.compiledDigest,
    });
    const run1 = await registry.pinRun({
      projectId: 'project-a',
      runId: 'run-1',
      expectedRegistryRevision: 1,
    });

    const profile2 = revision('profile-2', { parentRevisionId: 'profile-1' }, 'repo.write');
    await registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 2,
      revision: profile2,
    });
    await registry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 3,
      revisionId: profile2.revisionId,
      compiledDigest: profile2.compiledDigest,
    });

    const restoredProfile = revision('profile-3', {
      parentRevisionId: 'profile-2',
      restoredFromRevisionId: 'profile-1',
      source: { kind: 'sponsor_decision', sourceId: 'sponsor-rollback-1' },
    });
    await expect(registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 4,
      revision: restoredProfile,
    })).rejects.toThrow('only valid through registerRollback');

    const rolledBack = await registry.registerRollback({
      projectId: 'project-a',
      expectedRegistryRevision: 4,
      restoredFromRevisionId: 'profile-1',
      revision: restoredProfile,
    });
    expect(rolledBack.revisions['profile-3']).toMatchObject({
      parentRevisionId: 'profile-2',
      restoredFromRevisionId: 'profile-1',
    });
    await registry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 5,
      revisionId: restoredProfile.revisionId,
      compiledDigest: restoredProfile.compiledDigest,
    });

    const retriedRun1 = await registry.pinRun({
      projectId: 'project-a',
      runId: 'run-1',
      expectedRegistryRevision: 1,
    });
    const run2 = await registry.pinRun({
      projectId: 'project-a',
      runId: 'run-2',
      expectedRegistryRevision: 6,
    });
    expect(retriedRun1).toEqual(run1);
    expect(run1).toMatchObject({
      profileRevisionId: 'profile-1',
      profileDigest: profile1.compiledDigest,
      activationRegistryRevision: 1,
    });
    expect(run2).toMatchObject({
      profileRevisionId: 'profile-3',
      profileDigest: restoredProfile.compiledDigest,
      activationRegistryRevision: 6,
    });
    expect(Object.isFrozen(run2)).toBe(true);
  });

  it('fails closed when durable replay contains a governance decision for another digest', async () => {
    const journal = new MemoryProjectProfileJournal();
    const profile = persistedRevision(revision('profile-1'), -1);
    await journal.append('project-a', -1, [{
      type: 'profile.revision_registered',
      payload: {
        revision: {
          ...profile,
          governanceDecision: {
            ...profile.governanceDecision,
            compiledDigest: 'sha256:another-profile',
          },
        },
      },
    }]);

    await expect(new ProjectProfileRegistry(journal).read('project-a'))
      .rejects.toThrow('Profile governance decision scope mismatch');
  });

  it('fails closed when replayed rollback metadata does not restore the referenced composition', async () => {
    const journal = new MemoryProjectProfileJournal();
    const registry = createRegistry(journal);
    const profile1 = revision('profile-1');
    await registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: profile1,
    });
    await registry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 0,
      revisionId: profile1.revisionId,
      compiledDigest: profile1.compiledDigest,
    });
    const profile2 = revision('profile-2', { parentRevisionId: 'profile-1' }, 'repo.write');
    await registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 1,
      revision: profile2,
    });
    await registry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 2,
      revisionId: profile2.revisionId,
      compiledDigest: profile2.compiledDigest,
    });
    const activeProfile2 = (await registry.read('project-a')).revisions['profile-2'];
    if (!activeProfile2) throw new Error('active Profile fixture missing');
    await journal.append('project-a', 3, [{
      type: 'profile.revision_registered',
      payload: {
        revision: persistedRevision(revision('profile-3', {
          parentRevisionId: 'profile-2',
          restoredFromRevisionId: 'profile-1',
        }, 'repo.write'), 3, activeProfile2),
      },
    }]);

    await expect(registry.read('project-a'))
      .rejects.toThrow('does not restore Revision profile-1');
  });
});

function acceptanceRevision(
  revisionId: string,
  minimumRoute: 'baseline' | 'reviewer_required',
  parentRevisionId?: string,
): ProjectProfileRevisionCandidate {
  const pack: CapabilityPack = {
    id: 'acceptance-pack', version: '1.0.0', digest: 'sha256:acceptance-pack-v1', kind: 'policy',
    tools: [], skills: [], agents: [], workflows: [],
    acceptancePolicies: [{
      id: 'software-acceptance', digest: 'sha256:software-acceptance-v1',
      tasks: [{
        taskKey: 'build', kind: 'task_result',
        criteria: [{ id: 'tests', kind: 'deterministic', description: 'Tests pass' }],
        requiredEvidence: [], minimumRoute,
        reviewerPrincipalId: 'reviewer', sponsorPrincipalId: 'sponsor',
        reviewerTimeoutMs: 10, sponsorTimeoutMs: 20,
      }],
      memorySchema: { revision: 1, claimRules: [] },
    }],
  };
  const compiled = compileWorkroomProfile({
    revision: {
      id: revisionId, projectId: 'project-a', charterRevisionId: 'charter-7',
      packs: [{ id: pack.id, version: pack.version, digest: pack.digest }],
      enabledTools: [], enabledSkills: [], enabledAgents: [], enabledWorkflows: [],
      enabledAcceptancePolicies: ['software-acceptance'],
    },
    packs: [pack], generationSupply: { tools: [], skills: [], agents: [] },
  });
  if (!compiled.ok) throw new Error('Acceptance Profile fixture must compile');
  return {
    revisionId, projectId: 'project-a', charterRevisionId: 'charter-7',
    packRefs: compiled.profile.packRefs, overlayDigest: 'sha256:overlay',
    compiledDigest: compiled.profile.digest, compiledProfile: compiled.profile,
    ...(parentRevisionId ? { parentRevisionId } : {}),
    source: { kind: 'sponsor_decision', sourceId: `source:${revisionId}` },
  };
}
