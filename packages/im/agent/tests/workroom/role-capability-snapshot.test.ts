import { describe, expect, it } from 'vitest';
import { createAssignmentExecutionEnvelope } from '../../src/workroom/assignment-executor.js';
import {
  deepFreezeWorkroomValue,
  digestCanonicalWorkroomValue,
} from '../../src/workroom/canonical-value.js';
import {
  createWorkroomRoleCapabilityReference,
  createWorkroomRoleCapabilitySupply,
  createWorkroomRoleCapabilitySnapshot,
  discoverWorkroomRoleCapabilities,
  getWorkroomRoleCommandDescriptors,
  loadWorkroomRoleSkill,
  loadWorkroomRoleTool,
  type WorkroomRoleCapabilitySnapshotInput,
  type WorkroomRoleCapabilitySupply,
} from '../../src/workroom/role-capability-snapshot.js';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const SHA_C = `sha256:${'c'.repeat(64)}`;
const SHA_D = `sha256:${'d'.repeat(64)}`;
const SHA_E = `sha256:${'e'.repeat(64)}`;
const SHA_F = `sha256:${'f'.repeat(64)}`;

describe('WorkroomRoleCapabilitySnapshot', () => {
  it('projects the exact deeply frozen Tool/Skill intersection for one Assignment role', () => {
    const base = snapshotInput();
    const input = alignEnvelope({
      ...base,
      task: resealSupply(base.task, {
        tools: base.task.tools.filter(tool => tool.name !== 'write_repo'),
      }),
      policy: resealSupply(base.policy, { skills: [] }),
    });

    const snapshot = createWorkroomRoleCapabilitySnapshot(input);

    expect(snapshot).toMatchObject({
      version: 1,
      role: 'executor',
      tools: [
        { name: 'read_repo', digest: SHA_A },
        { name: 'run_tests', digest: SHA_B },
      ],
      skills: [],
    });
    expect(snapshot.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.tools)).toBe(true);
    expect(Object.isFrozen(snapshot.tools[0])).toBe(true);
    expect(Object.isFrozen(snapshot.skills)).toBe(true);
    expect(Object.isFrozen(snapshot.authorities)).toBe(true);
    expect(Object.isFrozen(input.generation.tools[0])).toBe(true);
  });

  it('fails closed on same-name digest conflicts and scope or role drift', () => {
    const base = snapshotInput();
    expect(() => createWorkroomRoleCapabilitySnapshot({
      ...base,
      policy: resealSupply(base.policy, {
        tools: base.policy.tools.map(tool => tool.name === 'read_repo'
          ? { ...tool, digest: SHA_F }
          : tool),
      }),
    })).toThrow('read_repo digest conflict');
    expect(() => createWorkroomRoleCapabilitySnapshot({
      ...base,
      task: resealSupply(base.task, { taskRevision: base.task.taskRevision + 1 }),
    })).toThrow('taskRevision scope drift');
    expect(() => createWorkroomRoleCapabilitySnapshot({
      ...base,
      role: resealSupply(base.role, { role: 'integration' }),
    })).toThrow('role scope drift');
  });

  it('fails closed when an allowed Skill depends on a Tool outside the exact intersection', () => {
    const base = snapshotInput();
    expect(() => createWorkroomRoleCapabilitySnapshot({
      ...base,
      policy: resealSupply(base.policy, {
        tools: base.policy.tools.filter(tool => tool.name !== 'run_tests'),
      }),
    })).toThrow('implement requires unauthorized Tool run_tests');
  });

  it.each(['spawn_task', 'workroom_plan_task', 'workroom_transition'])(
    'permanently rejects forbidden executor Tool %s',
    (name) => {
      expect(() => createWorkroomRoleCapabilitySnapshot(snapshotInput('executor', [{
        name,
        digest: SHA_E,
      }]))).toThrow(`forbids Tool ${name}`);
    },
  );

  it('provides typed role-only Workroom command descriptors without a generic transition', () => {
    expect(getWorkroomRoleCommandDescriptors('orchestrator').map(item => item.name))
      .toContain('plan_task');
    expect(getWorkroomRoleCommandDescriptors('reviewer').map(item => item.name))
      .toEqual(['request_evidence', 'submit_verdict']);
    expect(getWorkroomRoleCommandDescriptors('executor').every(item => item.role === 'executor'))
      .toBe(true);
    expect([
      'orchestrator', 'executor', 'reviewer', 'integration',
    ].flatMap(role => getWorkroomRoleCommandDescriptors(
      role as 'orchestrator' | 'executor' | 'reviewer' | 'integration',
    )).map(item => item.name)).not.toContain('workroom_transition');
    expect(() => getWorkroomRoleCommandDescriptors('chat' as 'executor'))
      .toThrow('unsupported role');
  });

  it('keeps deferred discovery and loading inside the immutable snapshot allowlist', () => {
    const input = snapshotInput();
    const snapshot = createWorkroomRoleCapabilitySnapshot(input);

    expect(discoverWorkroomRoleCapabilities(input.envelope, snapshot, 'read')).toEqual({
      tools: [{ name: 'read_repo', digest: SHA_A }],
      skills: [],
    });
    expect(loadWorkroomRoleTool(input.envelope, snapshot, 'read_repo', SHA_A)).toEqual({
      name: 'read_repo', digest: SHA_A,
    });
    expect(loadWorkroomRoleSkill(input.envelope, snapshot, 'implement', SHA_D)).toMatchObject({
      name: 'implement', requiredTools: ['read_repo', 'run_tests'],
    });
    expect(() => loadWorkroomRoleTool(input.envelope, snapshot, 'network', SHA_A)).toThrow('not allowlisted');
    expect(() => loadWorkroomRoleTool(input.envelope, snapshot, 'read_repo', SHA_F)).toThrow('digest conflict');
    expect(() => loadWorkroomRoleSkill(input.envelope, snapshot, 'unknown', SHA_D)).toThrow('not allowlisted');
  });

  it('allows only the exact role-owned Workroom commands for executor and integration snapshots', () => {
    const executorCommand = getWorkroomRoleCommandDescriptors('executor')[0]!;
    const integrationCommand = getWorkroomRoleCommandDescriptors('integration').at(-1)!;

    expect(createWorkroomRoleCapabilitySnapshot(snapshotInput('executor', [{
      name: executorCommand.toolName,
      digest: SHA_E,
    }])).tools).toContainEqual({ name: executorCommand.toolName, digest: SHA_E });
    expect(createWorkroomRoleCapabilitySnapshot(snapshotInput('integration', [{
      name: integrationCommand.toolName,
      digest: SHA_E,
    }])).tools).toContainEqual({ name: integrationCommand.toolName, digest: SHA_E });
    expect(() => createWorkroomRoleCapabilitySnapshot(snapshotInput('integration', [{
      name: executorCommand.toolName,
      digest: SHA_E,
    }]))).toThrow(`forbids Tool ${executorCommand.toolName}`);
  });

  it('rejects non-exact or duplicated supply descriptors', () => {
    const base = snapshotInput();
    expect(() => createWorkroomRoleCapabilitySnapshot({
      ...base,
      generation: {
        ...base.generation,
        tools: [...base.generation.tools, base.generation.tools[0]!],
      },
    })).toThrow('read_repo is duplicated');
    expect(() => createWorkroomRoleCapabilitySnapshot({
      ...base,
      profile: { ...base.profile, ambientAuthority: true } as WorkroomRoleCapabilitySupply,
    })).toThrow('forbidden field ambientAuthority');
    const { digest: _digest, ...generation } = base.generation;
    expect(() => createWorkroomRoleCapabilitySupply({
      ...generation,
      source: 'chat' as 'generation',
    })).toThrow('unsupported source chat');
  });

  it('content-addresses the full projection and rejects a tampered snapshot at deferred load', () => {
    const input = snapshotInput();
    const snapshot = createWorkroomRoleCapabilitySnapshot(input);
    const equivalent = createWorkroomRoleCapabilitySnapshot(snapshotInput());
    expect(equivalent.digest).toBe(snapshot.digest);
    expect(Object.isFrozen(loadWorkroomRoleSkill(
      input.envelope,
      snapshot,
      'implement',
      SHA_D,
    ))).toBe(true);
    const tampered = Object.freeze({ ...snapshot, projectId: 'project-other' });
    expect(() => loadWorkroomRoleTool(input.envelope, tampered, 'read_repo', SHA_A))
      .toThrow('Snapshot digest conflict');
  });

  it('rejects Tool allowlist drift when a supply retains its prior digest', () => {
    const base = snapshotInput();
    expect(() => createWorkroomRoleCapabilitySnapshot({
      ...base,
      policy: {
        ...base.policy,
        tools: base.policy.tools.filter(tool => tool.name !== 'write_repo'),
      },
    })).toThrow('policy digest does not match its exact content');
  });

  it('requires the Envelope capability ref, revision and digest from legal two-stage issuance', () => {
    const input = snapshotInput();
    const snapshot = createWorkroomRoleCapabilitySnapshot(input);
    expect(snapshot).toMatchObject({
      id: input.envelope.capabilitySnapshot.ref,
      ref: input.envelope.capabilitySnapshot.ref,
      revision: input.envelope.capabilitySnapshot.revision,
      digest: input.envelope.capabilitySnapshot.digest,
    });

    for (const capabilitySnapshot of [
      { ...input.envelope.capabilitySnapshot, ref: 'capability:other' },
      { ...input.envelope.capabilitySnapshot, revision: 2 },
      { ...input.envelope.capabilitySnapshot, digest: SHA_A },
    ]) {
      const { version: _version, digest: _digest, ...envelopeInput } = input.envelope;
      const envelope = createAssignmentExecutionEnvelope({
        ...envelopeInput,
        capabilitySnapshot,
      });
      expect(() => createWorkroomRoleCapabilitySnapshot({ ...input, envelope }))
        .toThrow('Envelope Capability Snapshot');
    }
  });

  it('rejects a re-digested frozen snapshot that smuggles spawn_task at deferred load', () => {
    const input = snapshotInput();
    const snapshot = createWorkroomRoleCapabilitySnapshot(input);
    const tools = [...snapshot.tools, { name: 'spawn_task', digest: SHA_E }]
      .sort((left, right) => left.name.localeCompare(right.name));
    const forged = deepFreezeWorkroomValue({
      ...snapshot,
      tools,
      digest: digestCanonicalWorkroomValue(capabilityContentForTest(snapshot, tools)),
    });

    expect(() => loadWorkroomRoleTool(input.envelope, forged, 'spawn_task', SHA_E))
      .toThrow();
  });

  it('rejects a self-signed ordinary Tool and replaced ref/revision against the trusted Envelope', () => {
    const input = snapshotInput();
    const snapshot = createWorkroomRoleCapabilitySnapshot(input);
    const tools = [...snapshot.tools, { name: 'network', digest: SHA_E }]
      .sort((left, right) => left.name.localeCompare(right.name));
    const network = deepFreezeWorkroomValue({
      ...snapshot,
      tools,
      digest: digestCanonicalWorkroomValue(capabilityContentForTest(snapshot, tools)),
    });
    expect(() => loadWorkroomRoleTool(input.envelope, network, 'network', SHA_E))
      .toThrow('does not match the trusted Envelope');

    for (const binding of [
      { ref: 'capability:other', revision: snapshot.revision },
      { ref: snapshot.ref, revision: snapshot.revision + 1 },
    ]) {
      const replaced = deepFreezeWorkroomValue({
        ...snapshot,
        id: binding.ref,
        ...binding,
        digest: digestCanonicalWorkroomValue({
          ...capabilityContentForTest(snapshot, snapshot.tools),
          ref: binding.ref,
          revision: binding.revision,
        }),
      });
      expect(() => discoverWorkroomRoleCapabilities(input.envelope, replaced))
        .toThrow('does not match the trusted Envelope');
    }
  });

  it('rejects unknown Snapshot and authority fields during deferred load', () => {
    const input = snapshotInput();
    const snapshot = createWorkroomRoleCapabilitySnapshot(input);
    const unknownSnapshot = deepFreezeWorkroomValue({ ...snapshot, chat: true });
    expect(() => loadWorkroomRoleTool(
      input.envelope,
      unknownSnapshot as typeof snapshot,
      'read_repo',
      SHA_A,
    )).toThrow('forbidden field chat');
    const [first, ...rest] = snapshot.authorities;
    const unknownAuthority = deepFreezeWorkroomValue({
      ...snapshot,
      authorities: [{ ...first!, ambientAuthority: true }, ...rest],
    });
    expect(() => discoverWorkroomRoleCapabilities(
      input.envelope,
      unknownAuthority as typeof snapshot,
    )).toThrow('forbidden field ambientAuthority');
  });
});

function snapshotInput(
  role: 'executor' | 'integration' = 'executor',
  extraTools: WorkroomRoleCapabilitySupply['tools'] = [],
): WorkroomRoleCapabilitySnapshotInput {
  const capabilitySnapshotRef = 'capability:assignment-1:1';
  const capabilitySnapshotRevision = 1;
  const scope = {
    projectId: 'project-1',
    runId: 'run-1',
    taskKey: 'build',
    taskRevision: 2,
    assignmentId: 'assignment-1',
    assignmentRevision: 3,
    role,
    capabilitySnapshotRef,
    capabilitySnapshotRevision,
  } as const;
  const sources = ['generation', 'profile', 'agent_definition', 'role', 'task', 'policy'] as const;
  const supplies = Object.fromEntries(sources.map((source, index) => [source,
    createWorkroomRoleCapabilitySupply({
      source,
      id: `source-${index + 1}`,
      revision: 1,
      ...scope,
      tools: [
        { name: 'read_repo', digest: SHA_A },
        { name: 'run_tests', digest: SHA_B },
        { name: 'write_repo', digest: SHA_C },
        ...extraTools,
      ],
      skills: [{
        name: 'implement',
        digest: SHA_D,
        requiredTools: ['read_repo', 'run_tests'],
      }],
    }),
  ])) as unknown as Pick<WorkroomRoleCapabilitySnapshotInput, typeof sources[number]>;
  const capabilitySnapshot = createWorkroomRoleCapabilityReference(supplies);
  const envelope = createAssignmentExecutionEnvelope({
    projectId: scope.projectId,
    runId: scope.runId,
    taskKey: scope.taskKey,
    taskRevision: scope.taskRevision,
    assignmentId: scope.assignmentId,
    assignmentRevision: scope.assignmentRevision,
    attempt: 1,
    fence: 7,
    principalId: 'agent:developer-1',
    role,
    agentDefinition: { ref: 'agent:developer:1', revision: 1, digest: SHA_A },
    plan: { ref: 'plan:run-1:1', revision: 1, digest: SHA_B },
    contextPolicy: { ref: 'context:1', revision: 1, digest: SHA_C },
    factAnchor: { ref: 'facts:run-1:2', sequence: 2, digest: SHA_D },
    capabilitySnapshot,
    policySnapshot: { ref: 'policy:assignment-1:1', revision: 1, digest: SHA_F },
    workspace: {
      leaseRef: 'workspace-lease:1', mountRef: 'workspace-mount:1', baseRevision: 'base-1', fence: 7,
    },
  });
  return { envelope, ...supplies };
}

function resealSupply(
  supply: WorkroomRoleCapabilitySupply,
  patch: Partial<Omit<WorkroomRoleCapabilitySupply, 'digest'>>,
): WorkroomRoleCapabilitySupply {
  const { digest: _digest, ...input } = supply;
  return createWorkroomRoleCapabilitySupply({ ...input, ...patch });
}

function alignEnvelope(
  input: WorkroomRoleCapabilitySnapshotInput,
): WorkroomRoleCapabilitySnapshotInput {
  const { envelope, ...supplies } = input;
  const capabilitySnapshot = createWorkroomRoleCapabilityReference(supplies);
  const { version: _version, digest: _digest, ...envelopeInput } = envelope;
  return {
    ...supplies,
    envelope: createAssignmentExecutionEnvelope({ ...envelopeInput, capabilitySnapshot }),
  };
}

function capabilityContentForTest(
  snapshot: ReturnType<typeof createWorkroomRoleCapabilitySnapshot>,
  tools: WorkroomRoleCapabilitySupply['tools'],
) {
  return {
    version: 1,
    ref: snapshot.ref,
    revision: snapshot.revision,
    scope: {
      projectId: snapshot.projectId,
      runId: snapshot.runId,
      taskKey: snapshot.taskKey,
      taskRevision: snapshot.taskRevision,
      assignmentId: snapshot.assignmentId,
      assignmentRevision: snapshot.assignmentRevision,
    },
    role: snapshot.role,
    authorities: snapshot.authorities,
    tools,
    skills: snapshot.skills,
  };
}
