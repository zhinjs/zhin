import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { AgentCapabilities, ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import {
  bindWorkroomCapabilityRealization,
} from '../../src/plugin-runtime/deferred-capability-plan.js';
import { createAgentCoreWorkroomLocalTurnPort } from '../../src/plugin-runtime/workroom-local-agent-core-adapter.js';
import { DurableReportLocalModelExecutionPort } from '../../src/plugin-runtime/workroom-local-agent-loop.js';
import type { AgentCore } from '../../src/core/agent-core.js';
import type { AgentLoopTurnInput } from '../../src/core/agent-core-run.js';
import type { ZhinAgentPrivate } from '../../src/internal/agent-host.js';
import {
  createAssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelopeInput,
} from '../../src/workroom/assignment-executor.js';
import {
  LocalAssignmentExecutor,
  type LocalAssignmentCapabilityProjectionPort,
} from '../../src/workroom/local-assignment-executor.js';
import {
  createWorkroomRoleCapabilityReference,
  createWorkroomRoleCapabilitySnapshot,
  createWorkroomRoleCapabilitySupply,
  type WorkroomRoleCapabilitySnapshotInput,
} from '../../src/workroom/role-capability-snapshot.js';

describe('Host to local Workroom Agent execution', () => {
  it('carries only the Envelope-authorized Tool and Skill surface into AgentCore', async () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    let coreInput: AgentLoopTurnInput | undefined;
    const core = {
      runText(input: AgentLoopTurnInput) {
        coreInput = input;
        return (async function* () {
          yield { type: 'chunk' as const, text: '', accumulated: '' };
          return {
            reply: JSON.stringify({
              claims: [{
                label: 'result', key: 'task.result', value: 'implemented', status: 'assumed',
                evidenceIds: [], artifactRefs: ['git:change-set'],
              }],
              evidence: [],
            }),
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
            path: 'agent' as const,
            iterations: 1,
            model: 'model',
            toolCalls: [],
          };
        })();
      },
    } as unknown as AgentCore;
    const reports = {
      writeEvidence: vi.fn(),
      writeReport: vi.fn(async report => ({ ref: report.ref, digest: report.digest })),
      read: vi.fn(),
    };
    const turn = createAgentCoreWorkroomLocalTurnPort({
      host: {} as ZhinAgentPrivate,
      core,
      generation: 7,
      resolveBinding: id => id === 'agent-definition:developer:1'
        ? {
            name: 'developer', providerAlias: 'provider', model: 'model',
            mcpServers: [], nickname: 'Developer',
          }
        : undefined,
    });
    const model = new DurableReportLocalModelExecutionPort({
      turn,
      reports,
      payloads: { write: vi.fn() },
    });
    const observations = [];

    for await (const observation of new LocalAssignmentExecutor(
      model,
      capabilityProjection(),
    ).execute(envelope, new AbortController().signal)) {
      observations.push(observation);
    }

    expect(observations.map(value => value.type)).toEqual([
      'heartbeat', 'progress', 'execution_completed',
    ]);
    expect(coreInput).toBeDefined();
    expect(coreInput!.allTools.map(tool => tool.name)).toEqual([
      'read_repo', 'discover', 'load_tool', 'load_skill',
    ]);
    expect(coreInput!.resolvedTools.map(tool => tool.name)).toEqual([
      'discover', 'load_tool', 'load_skill', 'read_repo',
    ]);
    expect(coreInput!.turnContext.capabilities.tools).toEqual([
      'read_repo', 'discover', 'load_tool', 'load_skill',
    ]);
    expect(coreInput!.promptRuntime?.activeSkillsContext).toBe('Use primary sources.');
    const modelSurface = JSON.stringify({
      tools: coreInput!.allTools.map(tool => tool.name),
      skills: coreInput!.promptRuntime?.activeSkillsContext,
    });
    expect(modelSurface).not.toContain('spawn_task');
    expect(modelSurface).not.toContain('workroom_');
    expect(modelSurface).not.toContain('Deploy the application.');
    expect(reports.writeEvidence).not.toHaveBeenCalled();
    expect(reports.writeReport).toHaveBeenCalledOnce();
  });
});

function envelopeInput(): AssignmentExecutionEnvelopeInput {
  const scope = assignmentScope();
  const supplies = capabilitySupplies(scope);
  return {
    projectId: scope.projectId,
    runId: scope.runId,
    taskKey: scope.taskKey,
    taskRevision: scope.taskRevision,
    assignmentId: scope.assignmentId,
    assignmentRevision: scope.assignmentRevision,
    attempt: 1,
    fence: 7,
    principalId: 'agent:developer-1',
    role: scope.role,
    agentDefinition: snapshot('agent-definition:developer:1', 'a'),
    plan: snapshot('workflow-plan:run-1:1', 'b'),
    contextPolicy: snapshot('context-policy:project-1:1', 'c'),
    factAnchor: { ref: 'workroom-facts:run-1:12', sequence: 12, digest: sha('d') },
    capabilitySnapshot: createWorkroomRoleCapabilityReference(supplies),
    policySnapshot: snapshot('policy-snapshot:run-1:1', 'e'),
    workspace: {
      leaseRef: 'workspace-lease:assignment-1:1',
      mountRef: '/workspace/worktree-1',
      baseRevision: 'git:base-sha',
      fence: 7,
    },
  };
}

function capabilityProjection(): LocalAssignmentCapabilityProjectionPort {
  const capabilities = assignmentCapabilities();
  return Object.freeze({
    async resolve(envelope) {
      const supplies = capabilitySupplies(assignmentScope());
      const capabilitySnapshot = createWorkroomRoleCapabilitySnapshot({ envelope, ...supplies });
      return Object.freeze({
        agentDefinitionId: 'agent-definition:developer:1',
        capabilities,
        capabilitySnapshot,
        realization: bindWorkroomCapabilityRealization(capabilities, envelope, capabilitySnapshot),
        sessionSnapshot: {
          loadedTools: {
            read_repo: 4,
            spawn_task: 3,
            workroom_claim_task: 2,
            workroom_executor_report_progress: 1,
          },
          loadedSkills: ['research', 'deploy'],
        },
        config: {
          deferredTools: {
            alwaysLoadedTools: [
              'discover', 'load_tool', 'load_skill', 'read_repo', 'spawn_task',
              'workroom_claim_task', 'workroom_executor_report_progress',
            ],
          },
        },
        persistSnapshot: async () => undefined,
        release: () => undefined,
      });
    },
  });
}

function assignmentScope() {
  return {
    projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
    assignmentId: 'assignment-1', assignmentRevision: 1, role: 'executor' as const,
    capabilitySnapshotRef: 'capability-snapshot:assignment-1:1',
    capabilitySnapshotRevision: 1,
  };
}

function capabilitySupplies(
  scope: ReturnType<typeof assignmentScope>,
): Omit<WorkroomRoleCapabilitySnapshotInput, 'envelope'> {
  const sources = [
    'generation', 'profile', 'agent_definition', 'role', 'task', 'policy',
  ] as const;
  return Object.fromEntries(sources.map((source, index) => [source,
    createWorkroomRoleCapabilitySupply({
      source,
      id: `authority-${index + 1}`,
      revision: 1,
      ...scope,
      tools: [{ name: 'read_repo', digest: sha('1') }],
      skills: [{ name: 'research', digest: sha('2'), requiredTools: ['read_repo'] }],
    }),
  ])) as unknown as Omit<WorkroomRoleCapabilitySnapshotInput, 'envelope'>;
}

function assignmentCapabilities(): AgentCapabilities {
  const owner = rootPluginId();
  return Object.freeze({
    generation: 7,
    owner,
    tools: Object.freeze([
      tool(owner, 'read_repo'),
      tool(owner, 'spawn_task'),
      tool(owner, 'workroom_claim_task'),
      tool(owner, 'workroom_executor_report_progress'),
    ]),
    skills: Object.freeze([
      skill(owner, 'research', 'Use primary sources.'),
      skill(owner, 'deploy', 'Deploy the application.'),
    ]),
    agents: Object.freeze([]),
    mcp: Object.freeze([]),
  });
}

function tool(owner: ReturnType<typeof rootPluginId>, name: string): ToolCapability {
  return Object.freeze({
    owner, name, qualifiedName: name, description: name, approval: 'never',
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
    owner, name, qualifiedName: name, description: name, instructions,
    source: `/skills/${name}/SKILL.md`,
  });
}

function snapshot(ref: string, character: string) {
  return { ref, revision: 1, digest: sha(character) };
}

function sha(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
