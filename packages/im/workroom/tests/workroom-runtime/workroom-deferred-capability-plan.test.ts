import { describe, expect, it } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolInvocationContext } from '@zhin.js/tool';
import {
  createDeferredCapabilityPlan,
  isReservedControlToolName,
  type AgentCapabilities,
  type ToolCapability,
} from '@zhin.js/agent/runtime';
import {
  bindWorkroomCapabilityRealization,
  createWorkroomDeferredCapabilityPlan,
  type WorkroomCapabilityRealization,
} from '../../src/workroom-runtime/workroom-capability-realization.js';
import { createAssignmentExecutionEnvelope } from '../../src/workroom/assignment-executor.js';
import {
  createWorkroomRoleCapabilityReference,
  getWorkroomRoleCommandDescriptors,
  createWorkroomRoleCapabilitySnapshot,
  createWorkroomRoleCapabilitySupply,
  type WorkroomRoleCapabilitySnapshot,
  type WorkroomRoleCapabilitySupply,
} from '../../src/workroom/role-capability-snapshot.js';

describe('Workroom DeferredCapabilityPlan realization', () => {
  it('classifies every Workroom control tool name as reserved', () => {
    const names = [
      ...(['orchestrator', 'executor', 'reviewer', 'integration'] as const)
        .flatMap(role => getWorkroomRoleCommandDescriptors(role).map(command => command.toolName)),
      'workroom_create_run',
      'workroom_plan_task',
      'workroom_transition',
    ];
    expect(names.length).toBeGreaterThan(3);
    for (const name of names) expect(isReservedControlToolName(name), name).toBe(true);
    expect(isReservedControlToolName('weather')).toBe(false);
  });

  it('physically limits Workroom discover and load to the trusted Assignment snapshot', async () => {
    const owner = rootPluginId();
    const capabilities: AgentCapabilities = Object.freeze({
      generation: 7,
      owner,
      tools: Object.freeze([
        tool(owner, 'read_repo', 'Read repository files'),
        tool(owner, 'write_repo', 'Write repository files'),
        tool(owner, 'spawn_task', 'Spawn a chat subtask'),
        tool(owner, 'workroom_transition', 'Generic Workroom transition'),
      ]),
      skills: Object.freeze([
        skill(owner, 'research', 'Use primary sources.'),
        skill(owner, 'deploy', 'Deploy the application.'),
      ]),
      agents: Object.freeze([]),
      mcp: Object.freeze([]),
      promptSections: Object.freeze([]),
    });
    const authority = workroomAuthority(capabilities, ['read_repo'], [{
      name: 'research', requiredTools: ['read_repo'],
    }]);
    const plan = createWorkroomDeferredCapabilityPlan({
      capabilities,
      authority,
      sessionSnapshot: {
        loadedTools: {
          read_repo: 4,
          write_repo: 3,
          spawn_task: 2,
          workroom_transition: 1,
        },
        loadedSkills: ['research', 'deploy'],
      },
      config: {
        deferredTools: {
          alwaysLoadedTools: [
            'discover', 'load_tool', 'load_skill', 'spawn_task', 'workroom_transition',
          ],
        },
      },
      persistSnapshot: async () => undefined,
    });

    expect(plan.allTools.map((entry) => entry.name)).toEqual([
      'read_repo', 'discover', 'load_tool', 'load_skill',
    ]);
    expect(plan.resolvedTools.map((entry) => entry.name)).toEqual([
      'discover', 'load_skill', 'load_tool', 'read_repo',
    ]);
    expect(plan.controller.loadedToolNames()).toEqual(['read_repo']);
    expect(plan.controller.loadedSkillInstructions()).toEqual(['Use primary sources.']);
    await expect(execute(plan.capabilities, 'discover', { query: '', kind: 'all' }))
      .resolves.toBe('- [skill] research: research');
    await expect(execute(plan.capabilities, 'discover', { query: 'spawn', kind: 'all' }))
      .resolves.toBe('No matches.');
    await expect(execute(plan.capabilities, 'load_tool', { name: 'spawn_task' }))
      .resolves.toBe('Tool "spawn_task" not found in catalog.');
    await expect(execute(plan.capabilities, 'load_skill', { name: 'deploy' }))
      .resolves.toContain("Skill 'deploy' not found");
  });

  it('never projects root or owner-qualified Workroom controls as ordinary model tools', () => {
    const owner = rootPluginId();
    const command = 'workroom_executor_report_progress';
    const qualifiedCommand = `plugin__${command}`;
    const capabilities: AgentCapabilities = Object.freeze({
      generation: 7,
      owner,
      tools: Object.freeze([
        tool(owner, 'spawn_task', 'Spawn a chat subtask'),
        tool(owner, command, 'Submit typed Workroom progress'),
        tool(owner, qualifiedCommand, 'Submit child-owned Workroom progress'),
      ]),
      skills: Object.freeze([]),
      agents: Object.freeze([]),
      mcp: Object.freeze([]),
      promptSections: Object.freeze([]),
    });
    const authority = workroomAuthority(capabilities, [command, qualifiedCommand], []);
    const workroom = createWorkroomDeferredCapabilityPlan({
      capabilities,
      authority,
      sessionSnapshot: {
        loadedTools: { [command]: 2, [qualifiedCommand]: 1 }, loadedSkills: [],
      },
      config: {
        deferredTools: { alwaysLoadedTools: ['spawn_task', command, qualifiedCommand] },
      },
      persistSnapshot: async () => undefined,
    });
    const chat = createDeferredCapabilityPlan({
      capabilities,
      sessionSnapshot: {
        loadedTools: { [command]: 2, [qualifiedCommand]: 1 }, loadedSkills: [],
      },
      config: {
        deferredTools: { alwaysLoadedTools: ['spawn_task', command, qualifiedCommand] },
      },
      persistSnapshot: async () => undefined,
    });

    expect(workroom.allTools.map((entry) => entry.name)).toEqual([
      'discover', 'load_tool', 'load_skill',
    ]);
    expect(chat.allTools.map((entry) => entry.name)).toContain('spawn_task');
    expect(chat.allTools.map((entry) => entry.name)).not.toContain(command);
    expect(chat.allTools.map((entry) => entry.name)).not.toContain(qualifiedCommand);
  });

  it('rejects same-name capabilities outside the trusted generation realization', () => {
    const owner = rootPluginId();
    const capabilities: AgentCapabilities = Object.freeze({
      generation: 7,
      owner,
      tools: Object.freeze([tool(owner, 'read_repo', 'Read repository files')]),
      skills: Object.freeze([skill(owner, 'research', 'Use primary sources.')]),
      agents: Object.freeze([]),
      mcp: Object.freeze([]),
      promptSections: Object.freeze([]),
    });
    const authority = workroomAuthority(capabilities, ['read_repo'], [{
      name: 'research', requiredTools: ['read_repo'],
    }]);
    const drifted: AgentCapabilities = Object.freeze({
      ...capabilities,
      tools: Object.freeze([tool(owner, 'read_repo', 'Changed implementation metadata')]),
    });

    expect(() => createWorkroomDeferredCapabilityPlan({
      capabilities: drifted,
      authority,
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      config: { deferredTools: {} },
      persistSnapshot: async () => undefined,
    })).toThrow('trusted generation realization');
  });
});

function tool(
  owner: ReturnType<typeof rootPluginId>,
  name: string,
  description: string,
): ToolCapability {
  return Object.freeze({
    owner,
    name,
    qualifiedName: name,
    description,
    requiresApproval: 'never',
    source: `/tools/${name}.ts`,
    execute: async <TInput = unknown, TResult = unknown>(input: TInput) => input as TResult,
  });
}

function skill(
  owner: ReturnType<typeof rootPluginId>,
  name: string,
  instructions: string,
) {
  return Object.freeze({
    $feature: 'zhin.skill/1' as const,
    owner,
    name,
    qualifiedName: name,
    description: name,
    instructions,
    source: `/skills/${name}/SKILL.md`,
  });
}

function workroomAuthority(
  capabilities: AgentCapabilities,
  toolNames: readonly string[],
  skillInputs: readonly Readonly<{ name: string; requiredTools: readonly string[] }>[],
): Readonly<{
  kind: 'workroom_assignment';
  envelope: ReturnType<typeof createAssignmentExecutionEnvelope>;
  capabilitySnapshot: WorkroomRoleCapabilitySnapshot;
  realization: WorkroomCapabilityRealization;
}> {
  const scope = {
    projectId: 'project-1',
    runId: 'run-1',
    taskKey: 'task-1',
    taskRevision: 1,
    assignmentId: 'assignment-1',
    assignmentRevision: 1,
    role: 'executor' as const,
    capabilitySnapshotRef: 'capability:assignment-1:1',
    capabilitySnapshotRevision: 1,
  };
  const sources = [
    'generation', 'profile', 'agent_definition', 'role', 'task', 'policy',
  ] as const;
  const tools: WorkroomRoleCapabilitySupply['tools'] = toolNames.map((name, index) => {
    if (!capabilities.tools.some(toolCapability => toolCapability.name === name)) {
      throw new Error(`missing test Tool ${name}`);
    }
    return {
      name,
      digest: sha('abcdef'[index % 6]!),
    };
  });
  const skills: WorkroomRoleCapabilitySupply['skills'] = skillInputs.map((input, index) => {
    if (!capabilities.skills.some(skillCapability => skillCapability.qualifiedName === input.name)) {
      throw new Error(`missing test Skill ${input.name}`);
    }
    return {
      ...input,
      digest: sha('fedcba'[index % 6]!),
    };
  });
  const supplies = Object.fromEntries(sources.map((source, index) => [source,
    createWorkroomRoleCapabilitySupply({
      source,
      id: `authority-${index + 1}`,
      revision: 1,
      ...scope,
      tools,
      skills,
    }),
  ])) as unknown as Record<typeof sources[number], WorkroomRoleCapabilitySupply>;
  const capabilitySnapshot = createWorkroomRoleCapabilityReference(supplies);
  const envelope = createAssignmentExecutionEnvelope({
    projectId: scope.projectId,
    runId: scope.runId,
    taskKey: scope.taskKey,
    taskRevision: scope.taskRevision,
    assignmentId: scope.assignmentId,
    assignmentRevision: scope.assignmentRevision,
    attempt: 1,
    fence: 1,
    principalId: 'agent:developer',
    role: scope.role,
    agentDefinition: { ref: 'agent:developer:1', revision: 1, digest: sha('c') },
    plan: { ref: 'plan:run-1:1', revision: 1, digest: sha('d') },
    contextPolicy: { ref: 'context:project-1:1', revision: 1, digest: sha('e') },
    factAnchor: { ref: 'facts:run-1:1', sequence: 1, digest: sha('f') },
    capabilitySnapshot,
    policySnapshot: { ref: 'policy:run-1:1', revision: 1, digest: sha('1') },
    workspace: {
      leaseRef: 'workspace:assignment-1:1',
      mountRef: 'mount:assignment-1:1',
      baseRevision: 'git:base',
      fence: 1,
    },
  });
  const roleSnapshot = createWorkroomRoleCapabilitySnapshot({
    envelope,
    ...supplies,
  });
  return Object.freeze({
    kind: 'workroom_assignment',
    envelope,
    capabilitySnapshot: roleSnapshot,
    realization: bindWorkroomCapabilityRealization(capabilities, envelope, roleSnapshot),
  });
}

function sha(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

async function execute(
  tools: readonly ToolCapability[],
  name: string,
  input: unknown,
): Promise<unknown> {
  const capability = tools.find((entry) => entry.name === name);
  if (!capability) throw new Error(`missing ${name}`);
  return capability.execute(input, invocation());
}

function invocation(): ToolInvocationContext {
  return Object.freeze({
    signal: new AbortController().signal,
    traceId: 'trace',
    turnId: 'turn',
    sessionKey: 'session',
    origin: { kind: 'internal', source: 'test' },
    principal: { subjectId: 'user', roles: ['user'] },
    policy: { permissions: ['user'], unattended: false, network: { enabled: false } },
  });
}
