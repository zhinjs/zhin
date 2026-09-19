import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  JournalWorkroomAssignmentGrantClaimPreview,
  WorkroomPlanningClarificationError,
  createAssignmentExecutionEnvelope,
  createDurableWorkroomAssignmentAuthorityGrantProvider,
  createWorkroomRoleCapabilitySnapshot,
} from '@zhin.js/agent';
import {
  DurableReportLocalModelExecutionPort,
  GenerationOwnedWorkroomAssignmentAuthorityProvider,
  LocalAssignmentExecutor,
  PinnedProfileCatalogLocalAssignmentRoute,
  WorkroomLocalAssignmentRuntime,
  bindWorkroomCapabilityRealization,
  createAgentCoreWorkroomLocalTurnPort,
  createGenerationOwnedDynamicPlanningProvider,
  createSelfDeliveryAssignmentExecutor,
  createWorkroomDynamicPlanningGenerationSnapshot,
  createWorkroomGenerationAuthoritySnapshotFromRuntime,
  installWorkroomSchedulerPortfolioDispatchResources,
  structuredTaskReportPrompt,
  workroomAssignmentAuthorityGrantRepositoryToken,
  workroomAssignmentAuthorityGrantToken,
  workroomAssignmentGrantClaimPreviewToken,
  workroomDynamicPlanningPolicyToken,
  workroomEvidencePayloadWriterToken,
  workroomHumanIngressPlanningToken,
  workroomLocalAssignmentAuthorityToken,
  workroomLocalAssignmentRuntimeToken,
  workroomPlanningDisclosureToken,
  workroomProjectProfileRegistryToken,
  workroomTaskReportPayloadToken,
  type CapabilityIngress,
  type SelfDeliveryHostConfiguration,
  type WorkroomEvidencePayloadWriteInput,
  type WorkroomSchedulerPortfolioDispatchResources,
  type WorkroomStructuredDagModelInput,
} from '@zhin.js/agent/runtime';
import { rootPluginId, type SnapshotReader } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import type { AgentRuntimeFoundation } from '../agent-runtime-foundation.js';
import {
  createLocalWorkroomAssignmentGrantProvider,
  LOCAL_WORKROOM_RESOURCE_REQUIREMENTS,
} from './local-portfolio.js';
import type { WorkroomAcceptanceCoordinator } from './acceptance-coordinator.js';
import type { WorkroomPersistenceCoordinator } from './persistence-coordinator.js';
import type { WorkroomProfileCoordinator } from './profile-coordinator.js';
import type { WorkroomRuntimeFoundation } from './runtime-foundation.js';

const logger = getLogger('agent');
const WORKROOM_DYNAMIC_PLANNING_SYSTEM_PROMPT = `You produce one untrusted Workroom DAG candidate as strict JSON.
Return exactly: {"version":1,"strategy":{"id":"...","version":"...","digest":"sha256:..."},"tasks":[...]}
Each task must contain exactly: key, title, role, required, maxAttempts, localRank, dependsOn, requires, approval.
requires must contain exactly tools, skills, integrations, authorities arrays. approval is "none" or "sponsor_required".
Copy every requirement only from the matching supplied capability array: tools from tools, skills from skills, integrations from integrations, and authorities from authorities. Never classify a skill as a tool.
Use only the supplied strategies, roles, capabilities and constraints. Include at least one required task.
Do not output markdown, commentary, identity, authority, Project state, Sponsor lane, deadline, policy, assignment, or execution state.`;

type RootResourceContext = Parameters<RootResourceInstaller>[0];

export interface WorkroomAssignmentCoordinatorOptions {
  readonly projectRoot: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: RootResourceContext['resources'];
  readonly lifecycle: RootResourceContext['lifecycle'];
  readonly handoff: RootResourceContext['handoff'];
  readonly snapshots: SnapshotReader;
  readonly selfDelivery?: SelfDeliveryHostConfiguration;
  readonly ingress: CapabilityIngress;
  readonly agent: AgentRuntimeFoundation;
  readonly runtime: WorkroomRuntimeFoundation;
  readonly profiles: WorkroomProfileCoordinator;
  readonly persistence: WorkroomPersistenceCoordinator;
  readonly acceptance: WorkroomAcceptanceCoordinator;
}

/** Owns Assignment authority, planning supply, capability projection, and local execution. */
export class WorkroomAssignmentCoordinator {
  readonly dispatch: WorkroomSchedulerPortfolioDispatchResources;

  constructor(options: WorkroomAssignmentCoordinatorOptions) {
    const { generation, signal, resources, lifecycle, handoff, ingress } = options;
    signal.throwIfAborted();
    const service = options.agent.service;
    const composedRuntime = options.agent.composition;
    const listGenerationBindings = () => options.agent.listBindings();
    const assignmentAuthorityGrants = options.persistence.assignmentAuthorityGrants;
    const workroomJournal = options.runtime.journal;
    const workroomCatalog = options.runtime.catalog;
    const workroomKernel = options.runtime.kernel;
    const projectProfiles = options.profiles.profiles;
    const workroomReports = options.acceptance.reports;
    this.dispatch = installWorkroomSchedulerPortfolioDispatchResources({
      generation,
      signal,
      resources,
      catalog: workroomCatalog,
      profiles: projectProfiles,
      journal: workroomJournal,
      runState: Object.freeze({
        read: (projectId: string, runId: string) => workroomKernel.read(projectId, runId),
        pinTaskAcceptance: (projectId: string, runId: string, taskKey: string) =>
          workroomKernel.pinTaskAcceptance(projectId, runId, taskKey),
      }),
      fallbackResourceRequirements: LOCAL_WORKROOM_RESOURCE_REQUIREMENTS,
    });
    resources.provide(workroomAssignmentAuthorityGrantRepositoryToken, assignmentAuthorityGrants);
    const durableAssignmentGrants = createDurableWorkroomAssignmentAuthorityGrantProvider({
      repository: assignmentAuthorityGrants,
      generation,
    });
    resources.provide(
      workroomAssignmentAuthorityGrantToken,
      createLocalWorkroomAssignmentGrantProvider({
        generation,
        projectRoot: options.projectRoot,
        repository: assignmentAuthorityGrants,
        durable: durableAssignmentGrants,
        journal: workroomJournal,
        catalog: workroomCatalog,
        profiles: projectProfiles,
        runState: Object.freeze({
          read: (projectId: string, runId: string) => workroomKernel.read(projectId, runId),
        }),
      }),
    );
    resources.provide(
      workroomAssignmentGrantClaimPreviewToken,
      new JournalWorkroomAssignmentGrantClaimPreview({
        generation,
        journal: workroomJournal,
        profiles: projectProfiles,
        catalog: workroomCatalog,
      }),
    );
    if (!resources.has(workroomLocalAssignmentAuthorityToken)) {
      resources.provide(workroomLocalAssignmentAuthorityToken, Object.freeze({
        resolveLocal: async (
          input: Parameters<GenerationOwnedWorkroomAssignmentAuthorityProvider['resolveLocal']>[0],
        ) => {
          const lease = options.snapshots.acquire();
          try {
            if (lease.value.generation !== generation) {
              throw new Error('Local Assignment authority generation is no longer current');
            }
            return await new GenerationOwnedWorkroomAssignmentAuthorityProvider({
              generation: createWorkroomGenerationAuthoritySnapshotFromRuntime(
                lease.value,
                listGenerationBindings(),
              ),
              profiles: projectProfiles,
              catalog: workroomCatalog,
              grants: resources.use(workroomAssignmentAuthorityGrantToken),
              endpoints: Object.freeze({ resolve: async () => undefined }),
            }).resolveLocal(input);
          } finally {
            lease.release();
          }
        },
      }));
    }
    if (!resources.has(workroomHumanIngressPlanningToken)) {
      resources.provide(workroomHumanIngressPlanningToken, createGenerationOwnedDynamicPlanningProvider({
        generation: createWorkroomDynamicPlanningGenerationSnapshot(generation),
        profiles: resources.use(workroomProjectProfileRegistryToken),
        catalog: workroomCatalog,
        resolvePolicy: () => resources.has(workroomDynamicPlanningPolicyToken)
          ? resources.use(workroomDynamicPlanningPolicyToken)
          : undefined,
        resolveDisclosure: () => resources.has(workroomPlanningDisclosureToken)
          ? resources.use(workroomPlanningDisclosureToken)
          : undefined,
        signal,
        model: Object.freeze({
          async generate(modelInput: WorkroomStructuredDagModelInput, operationSignal: AbortSignal) {
            operationSignal.throwIfAborted();
            if (modelInput.binding.generation !== generation) {
              throw new Error('Dynamic planning model binding escaped its Root generation');
            }
            const binding = service.getBindingRegistry()
              .getBinding(modelInput.binding.agentDefinitionId);
            if (!binding) throw new WorkroomPlanningClarificationError('planning_unavailable');
            const result = await service.runAgent(JSON.stringify(modelInput.prompt), {
              provider: binding.providerAlias,
              model: binding.model,
              systemPrompt: WORKROOM_DYNAMIC_PLANNING_SYSTEM_PROMPT,
              tools: [],
              includeRegisteredTools: false,
              maxIterations: 1,
              signal: operationSignal,
            });
            operationSignal.throwIfAborted();
            try {
              return JSON.parse(result.content) as unknown;
            } catch (error) {
              throw new Error('Dynamic planning model did not return one strict JSON DAG candidate', {
                cause: error,
              });
            }
          },
        }),
      }));
    }
    if (resources.has(workroomLocalAssignmentAuthorityToken)) {
      const localTurn = createAgentCoreWorkroomLocalTurnPort({
        host: composedRuntime.host,
        core: composedRuntime.agentCore,
        generation,
        loopHooks: service.loopHooks,
        resolveBinding: agentDefinitionId => agentDefinitionId
          ? service.getBindingRegistry().getBinding(agentDefinitionId) ?? undefined
          : undefined,
      });
      const localModel = new DurableReportLocalModelExecutionPort({
        turn: localTurn,
        reports: workroomReports,
        payloads: Object.freeze({
          write: async (input: WorkroomEvidencePayloadWriteInput, signal: AbortSignal) => {
            if (!resources.has(workroomEvidencePayloadWriterToken)) {
              throw new Error('Governed Workroom Evidence Payload Writer is unavailable');
            }
            return await resources.use(workroomEvidencePayloadWriterToken).write(input, signal);
          },
        }),
        readPrompt: async request => {
          const state = await workroomKernel.read(
            request.envelope.projectId,
            request.envelope.runId,
          );
          const task = state.tasks[request.envelope.taskKey];
          if (!task || task.revision !== request.envelope.taskRevision) {
            throw new Error('Local Assignment prompt targets a stale Task revision');
          }
          return [
            `Execute Workroom Task: ${task.title}`,
            `Task identity: ${task.key}@${task.revision}`,
            `Workspace mount: ${request.envelope.workspace.mountRef}`,
            `Acceptance Contract: ${task.acceptanceContract?.id ?? 'missing'}`,
            ...structuredTaskReportPrompt(),
            'Do not use chat Subagent lifecycle or emit Task status commands.',
          ].join('\n');
        },
      });
      const capabilityProjection = Object.freeze({
        resolve: async (envelope: Parameters<LocalAssignmentExecutor['execute']>[0]) => {
          const lease = options.snapshots.acquire();
          let releaseOwned = true;
          try {
            if (lease.value.generation !== generation) {
              throw new Error('Local Assignment capability generation is no longer current');
            }
            const issuance = (await workroomKernel.listLocalAssignmentIssuances())
              .find(candidate => candidate.envelope.assignmentId === envelope.assignmentId);
            if (!issuance || issuance.envelope.digest !== envelope.digest) {
              throw new Error('Local Assignment capability projection lacks exact issuance');
            }
            const state = await workroomKernel.read(envelope.projectId, envelope.runId);
            const task = state.tasks[envelope.taskKey];
            if (!task?.acceptanceContract || task.revision !== envelope.taskRevision) {
              throw new Error('Local Assignment capability projection targets a stale Task');
            }
            const authority = await resources.use(workroomLocalAssignmentAuthorityToken).resolveLocal({
              projectId: envelope.projectId,
              runId: envelope.runId,
              task: Object.freeze({
                key: task.key,
                revision: task.revision,
                acceptanceContract: task.acceptanceContract,
              }),
              assignment: Object.freeze({
                id: envelope.assignmentId,
                revision: envelope.assignmentRevision,
                attempt: envelope.attempt,
                fence: envelope.fence,
              }),
              requestedAgentDefinitionId: issuance.agentDefinitionId,
              factAnchor: envelope.factAnchor,
            });
            const canonicalEnvelope = createAssignmentExecutionEnvelope({
              projectId: envelope.projectId,
              runId: envelope.runId,
              taskKey: envelope.taskKey,
              taskRevision: envelope.taskRevision,
              assignmentId: envelope.assignmentId,
              assignmentRevision: envelope.assignmentRevision,
              attempt: envelope.attempt,
              fence: envelope.fence,
              principalId: authority.principalId,
              role: authority.role,
              agentDefinition: authority.agentDefinition,
              plan: authority.plan,
              contextPolicy: authority.contextPolicy,
              factAnchor: envelope.factAnchor,
              capabilitySnapshot: authority.capabilitySnapshot,
              policySnapshot: authority.policySnapshot,
              workspace: authority.workspace,
            });
            if (canonicalEnvelope.digest !== envelope.digest) {
              throw new Error('Local Assignment current generation authority drifted from Envelope');
            }
            const capabilities = await ingress.read(
              lease.value,
              rootPluginId(),
              () => lease.active,
            );
            const capabilitySnapshot = createWorkroomRoleCapabilitySnapshot({
              envelope,
              ...authority.capabilitySupplies,
            });
            const projection = Object.freeze({
              agentDefinitionId: issuance.agentDefinitionId,
              capabilities,
              capabilitySnapshot,
              realization: bindWorkroomCapabilityRealization(
                capabilities,
                envelope,
                capabilitySnapshot,
              ),
              sessionSnapshot: Object.freeze({ loadedTools: {}, loadedSkills: [] }),
              config: composedRuntime.host.config,
              persistSnapshot: async () => undefined,
              release: () => {
                if (!releaseOwned) return;
                releaseOwned = false;
                lease.release();
              },
            });
            return projection;
          } catch (error) {
            if (releaseOwned) {
              releaseOwned = false;
              lease.release();
            }
            throw error;
          }
        },
      });
      const standardLocalExecutor = new LocalAssignmentExecutor(localModel, capabilityProjection);
      const localAssignments = new WorkroomLocalAssignmentRuntime({
        kernel: workroomKernel,
        executor: options.selfDelivery
          ? createSelfDeliveryAssignmentExecutor(options.selfDelivery, standardLocalExecutor)
          : standardLocalExecutor,
        intervalMs: 1_000,
        onError: error => logger.error(formatCompact({
          op: 'workroom_local_assignment',
          error: error instanceof Error ? error.message : String(error),
        })),
      });
      resources.provide(workroomLocalAssignmentRuntimeToken, localAssignments);
      const localRoute = new PinnedProfileCatalogLocalAssignmentRoute({ profiles: projectProfiles });
      lifecycle.add(this.dispatch.routes.register({
        providerId: `local-agent-bindings:generation:${generation}`,
        generation,
        resolve: async input => {
          if (!resources.has(workroomEvidencePayloadWriterToken)
            || !resources.has(workroomTaskReportPayloadToken)) return null;
          const route = await localRoute.resolve(input);
          if (!route || route.kind !== 'local') return null;
          return service.getBindingRegistry().getBinding(route.agentDefinitionId)
            ? route
            : null;
        },
      }));
      lifecycle.add(() => localAssignments.dispose());
      handoff.add({
        activateNext: signal => {
          signal.throwIfAborted();
          localAssignments.start();
        },
      });
    }
  }
}
