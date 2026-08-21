import {
  compileWorkroomProfile,
  type CapabilityPack,
  type WorkroomProfileCompilerInput,
} from '../../src/workroom/profile-compiler.js';

function pack(overrides: Partial<CapabilityPack> = {}): CapabilityPack {
  return {
    id: 'software-domain',
    version: '1.0.0',
    digest: 'sha256:software-domain-v1',
    kind: 'domain',
    tools: [{ id: 'repo.read', digest: 'sha256:repo-read-v1' }],
    skills: [{
      id: 'inspect-repository',
      digest: 'sha256:inspect-repository-v1',
      requiresTools: ['repo.read'],
    }],
    agents: [{
      id: 'software-researcher',
      digest: 'sha256:software-researcher-v1',
      role: 'researcher',
      allowedTools: ['repo.read'],
      allowedSkills: ['inspect-repository'],
    }],
    workflows: [{
      id: 'change-workflow',
      digest: 'sha256:change-workflow-v1',
      requiredByProfile: true,
      tasks: [{
        key: 'inspect',
        role: 'researcher',
        requires: { skills: ['inspect-repository'] },
      }],
    }],
    ...overrides,
  };
}

function compilerInput(overrides: Partial<WorkroomProfileCompilerInput> = {}): WorkroomProfileCompilerInput {
  const domain = pack();
  return {
    revision: {
      id: 'profile-revision-1',
      projectId: 'project-a',
      charterRevisionId: 'charter-7',
      packs: [{ id: domain.id, version: domain.version, digest: domain.digest }],
      enabledTools: ['repo.read'],
      enabledSkills: ['inspect-repository'],
      enabledAgents: ['software-researcher'],
      enabledWorkflows: ['change-workflow'],
    },
    packs: [domain],
    generationSupply: {
      tools: [{ id: 'repo.read', digest: 'sha256:repo-read-v1' }],
      skills: [{ id: 'inspect-repository', digest: 'sha256:inspect-repository-v1' }],
      agents: [{ id: 'software-researcher', digest: 'sha256:software-researcher-v1' }],
    },
    ...overrides,
  };
}

describe('compileWorkroomProfile', () => {
  it('compiles an exact revision into a deterministic minimal capability projection', () => {
    const input = compilerInput();
    const first = compileWorkroomProfile(input);
    const second = compileWorkroomProfile({
      ...input,
      packs: [...input.packs].reverse(),
      generationSupply: {
        tools: [...input.generationSupply.tools].reverse(),
        skills: [...input.generationSupply.skills].reverse(),
        agents: [...input.generationSupply.agents].reverse(),
      },
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      profile: {
        revisionId: 'profile-revision-1',
        projectId: 'project-a',
        charterRevisionId: 'charter-7',
        tools: [{ id: 'repo.read', digest: 'sha256:repo-read-v1' }],
        skills: [{
          id: 'inspect-repository',
          digest: 'sha256:inspect-repository-v1',
          requiresTools: ['repo.read'],
        }],
        agents: [{
          id: 'software-researcher',
          digest: 'sha256:software-researcher-v1',
          role: 'researcher',
          allowedTools: ['repo.read'],
          allowedSkills: ['inspect-repository'],
        }],
        workflows: [{ id: 'change-workflow' }],
      },
    });
    expect(first.ok && first.profile.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.ok && Object.isFrozen(first.profile)).toBe(true);
    expect(first.ok && Object.isFrozen(first.profile.skills[0]?.requiresTools)).toBe(true);
  });

  it('fails closed on exact Pack and dependency digest mismatches with stable diagnostics', () => {
    const domain = pack();
    const competency = pack({
      id: 'research-competency',
      version: '2.0.0',
      digest: 'sha256:research-competency-v2',
      kind: 'competency',
      requires: [{
        id: domain.id,
        version: domain.version,
        digest: 'sha256:stale-domain',
      }],
      tools: [],
      skills: [],
      agents: [],
      workflows: [],
    });
    const input = compilerInput({
      packs: [competency, domain],
      revision: {
        ...compilerInput().revision,
        packs: [
          { id: domain.id, version: domain.version, digest: domain.digest },
          { id: competency.id, version: competency.version, digest: competency.digest },
        ],
      },
    });

    const dependencyMismatch = compileWorkroomProfile(input);
    const reordered = compileWorkroomProfile({ ...input, packs: [...input.packs].reverse() });
    const exactMismatch = compileWorkroomProfile({
      ...input,
      revision: {
        ...input.revision,
        packs: [{ id: domain.id, version: domain.version, digest: 'sha256:tampered' }],
      },
    });

    expect(dependencyMismatch).toEqual(reordered);
    expect(dependencyMismatch).toMatchObject({
      ok: false,
      diagnostics: [{
        code: 'pack.dependency_digest_mismatch',
        path: 'packs.research-competency@2.0.0.requires.software-domain@1.0.0',
      }],
    });
    expect(exactMismatch).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({
        code: 'pack.digest_mismatch',
        path: 'revision.packs.software-domain@1.0.0',
      })]),
    });
    expect(Object.isFrozen(dependencyMismatch.diagnostics)).toBe(true);
  });

  it('never lets a Skill authorize required Tools beyond supply, Profile selection, or Agent ceiling', () => {
    const base = compilerInput();
    const outsideGeneration = compileWorkroomProfile({
      ...base,
      generationSupply: { ...base.generationSupply, tools: [] },
    });
    const outsideProfile = compileWorkroomProfile({
      ...base,
      revision: { ...base.revision, enabledTools: [] },
    });
    const ceilingPack = pack({
      agents: [{
        id: 'software-researcher',
        digest: 'sha256:software-researcher-v1',
        role: 'researcher',
        allowedTools: [],
        allowedSkills: ['inspect-repository'],
      }],
    });
    const outsideAgentCeiling = compileWorkroomProfile({
      ...base,
      packs: [ceilingPack],
    });

    expect(outsideGeneration).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({
        code: 'tool.generation_supply_mismatch',
      })]),
    });
    expect(outsideProfile).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({
        code: 'skill.required_tool_not_enabled',
        path: 'skills.inspect-repository.requiresTools.repo.read',
      })]),
    });
    expect(outsideAgentCeiling).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({
        code: 'workflow.task_unsatisfied',
        path: 'workflows.change-workflow.tasks.inspect',
      })]),
    });
  });

  it('rejects canonical capability conflicts and omitted required Workflows deterministically', () => {
    const domain = pack();
    const conflicting = pack({
      id: 'conflicting-pack',
      digest: 'sha256:conflicting-pack-v1',
      kind: 'competency',
      tools: [{ id: 'repo.read', digest: 'sha256:other-repo-read' }],
      skills: [],
      agents: [],
      workflows: [],
    });
    const revision = {
      ...compilerInput().revision,
      packs: [domain, conflicting].map(({ id, version, digest }) => ({ id, version, digest })),
      enabledWorkflows: [],
    };
    const input = compilerInput({ packs: [domain, conflicting], revision });

    const first = compileWorkroomProfile(input);
    const second = compileWorkroomProfile({ ...input, packs: [...input.packs].reverse() });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'tool.canonical_conflict',
          path: 'tools.repo.read',
        }),
        expect.objectContaining({
          code: 'workflow.required_not_enabled',
          path: 'workflows.change-workflow',
        }),
      ]),
    });
  });

  it('keeps digest and diagnostics stable when exact revision Pack refs are reordered', () => {
    const domainV1 = pack();
    const domainV2 = pack({
      version: '2.0.0',
      digest: 'sha256:software-domain-v2',
      kind: 'competency',
      tools: [],
      skills: [],
      agents: [],
      workflows: [],
    });
    const base = compilerInput({
      packs: [domainV1, domainV2],
      revision: {
        ...compilerInput().revision,
        packs: [domainV1, domainV2].map(({ id, version, digest }) => ({ id, version, digest })),
      },
    });
    const reversed = {
      ...base,
      revision: { ...base.revision, packs: [...base.revision.packs].reverse() },
    };

    expect(compileWorkroomProfile(base)).toEqual(compileWorkroomProfile(reversed));

    const mismatched = {
      ...base,
      revision: {
        ...base.revision,
        packs: base.revision.packs.map((ref) => ref.version === '2.0.0'
          ? { ...ref, digest: 'sha256:tampered' }
          : ref),
      },
    };
    const mismatchedReversed = {
      ...mismatched,
      revision: { ...mismatched.revision, packs: [...mismatched.revision.packs].reverse() },
    };
    expect(compileWorkroomProfile(mismatched)).toEqual(compileWorkroomProfile(mismatchedReversed));
  });

  it('fails deterministically when the generation supply has conflicting canonical digests', () => {
    const input = compilerInput();
    const tools = [
      ...input.generationSupply.tools,
      { id: 'repo.read', digest: 'sha256:conflicting-generation-tool' },
    ];
    const first = compileWorkroomProfile({
      ...input,
      generationSupply: { ...input.generationSupply, tools },
    });
    const reversed = compileWorkroomProfile({
      ...input,
      generationSupply: { ...input.generationSupply, tools: [...tools].reverse() },
    });

    expect(first).toEqual(reversed);
    expect(first).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({
        code: 'tool.generation_supply_conflict',
        path: 'generationSupply.tools.repo.read',
      })]),
    });
  });
});
