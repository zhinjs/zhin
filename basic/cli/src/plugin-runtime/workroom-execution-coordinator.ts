import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { outboundMessageToken, type ImRuntime } from '@zhin.js/core/runtime';
import {
  FilePortfolioJournalRepository,
  FileWorkroomProjectionRepository,
  JournalWorkroomAssignmentGrantClaimPreview,
  WorkroomPlanningClarificationError,
  createAssignmentExecutionEnvelope,
  createDurableWorkroomAssignmentAuthorityGrantProvider,
  createWorkroomRoleCapabilitySnapshot,
  type WorkroomPreemptionState,
} from '@zhin.js/agent';
import {
  DurableReportLocalModelExecutionPort,
  GenerationOwnedPortfolioCapacityRuntime,
  GenerationOwnedWorkroomAssignmentAuthorityProvider,
  JournalWorkroomPreemptionCheckpointAckReader,
  KernelPortfolioGrantAssignmentIssuance,
  LocalAssignmentExecutor,
  PinnedProfileCatalogLocalAssignmentRoute,
  PortfolioGrantAssignmentAuthority,
  WorkroomAssignmentCheckpointDelivery,
  WorkroomLocalAssignmentRuntime,
  WorkroomPortfolioCheckpointAckAdapter,
  WorkroomPortfolioAssignmentFailureAuthority,
  WorkroomPortfolioGrantAssignmentSaga,
  WorkroomPreemptionRuntime,
  WorkroomProjectionReplyResolver,
  WorkroomProjectionRuntime,
  WorkroomProjectionScheduler,
  WorkroomSchedulerRuntime,
  WorkroomSchedulerSupplyUnavailableError,
  WorkroomPortfolioSponsorRuntime,
  bindWorkroomCapabilityRealization,
  createAgentCoreWorkroomLocalTurnPort,
  createCatalogGovernedWorkroomProjectionAuthority,
  createCatalogPortfolioSponsorCommandAuthority,
  createGovernedPortfolioSponsorProjectionReader,
  createGenerationOwnedDynamicPlanningProvider,
  createSelfDeliveryAssignmentExecutor,
  createWorkroomDynamicPlanningGenerationSnapshot,
  createWorkroomGenerationAuthoritySnapshotFromRuntime,
  createWorkroomProjectionOutboundMessageServicePort,
  createWorkroomRemoteCallbackRuntime,
  createWorkroomSchedulerKernelCommandPort,
  installWorkroomPortfolioControlWorker,
  installWorkroomSchedulerPortfolioDispatchResources,
  portfolioAtomicBundleAuthorityToken,
  portfolioCapacityRuntimeToken,
  portfolioClockAuthorityToken,
  portfolioControlOutboxRepositoryToken,
  portfolioJournalRepositoryToken,
  portfolioKernelCommandAuthorityToken,
  portfolioPolicyAuthorityToken,
  portfolioSponsorCommandToken,
  portfolioUsageGatewayAuthorityToken,
  selfDeliveryProjectToken,
  structuredTaskReportPrompt,
  workroomAssignmentAuthorityGrantRepositoryToken,
  workroomAssignmentAuthorityGrantToken,
  workroomAssignmentGrantClaimPreviewToken,
  workroomCheckpointDeliveryProviderToken,
  workroomDynamicPlanningPolicyToken,
  workroomEvidencePayloadWriterToken,
  workroomHumanIngressPlanningToken,
  workroomLocalAssignmentAuthorityToken,
  workroomLocalAssignmentRuntimeToken,
  workroomPlanningDisclosureToken,
  workroomPortfolioCheckpointAckAdapterToken,
  workroomPreemptionRuntimeToken,
  workroomProjectProfileRegistryToken,
  workroomRemoteCallbackRuntimeToken,
  workroomSchedulerCapacityRequestToken,
  workroomSchedulerDispatchSupplyToken,
  workroomSchedulerRuntimeToken,
  workroomTaskReportPayloadToken,
  type AgentHostPortfolioSponsorControlPort,
  type CapabilityIngress,
  type PortfolioAtomicBundleAuthorityPort,
  type PortfolioClockAuthorityPort,
  type PortfolioKernelCommandAuthorityPort,
  type PortfolioSponsorProjection,
  type PortfolioUsageGatewayAuthorityPort,
  type SelfDeliveryHostConfiguration,
  type WorkroomEvidencePayloadWriteInput,
  type WorkroomStructuredDagModelInput,
} from '@zhin.js/agent/runtime';
import { rootPluginId, type SnapshotReader } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import {
  createLocalWorkroomAssignmentGrantProvider,
  installLocalWorkroomPortfolioAuthorities,
  LOCAL_WORKROOM_RESOURCE_REQUIREMENTS,
} from './local-workroom-portfolio.js';
import {
  ensureCatalogWorkroomProjectionBinding,
  resolveCatalogSponsorProjectionConversation,
  resolveCatalogWorkroomProjectionConversation,
} from './workroom-projection.js';
import type { AgentRuntimeFoundation } from './agent-runtime-foundation.js';
import type { WorkroomAcceptanceCoordinator } from './workroom-acceptance-coordinator.js';
import type { WorkroomDataGovernanceCoordinator } from './workroom-data-governance-coordinator.js';
import type { WorkroomPersistenceCoordinator } from './workroom-persistence-coordinator.js';
import type { WorkroomProfileCoordinator } from './workroom-profile-coordinator.js';
import type { WorkroomRuntimeFoundation } from './workroom-runtime-foundation.js';

const logger = getLogger('agent');
const WORKROOM_DYNAMIC_PLANNING_SYSTEM_PROMPT = `You produce one untrusted Workroom DAG candidate as strict JSON.
Return exactly: {"version":1,"strategy":{"id":"...","version":"...","digest":"sha256:..."},"tasks":[...]}
Each task must contain exactly: key, title, role, required, maxAttempts, localRank, dependsOn, requires, approval.
requires must contain exactly tools, skills, integrations, authorities arrays. approval is "none" or "sponsor_required".
Copy every requirement only from the matching supplied capability array: tools from tools, skills from skills, integrations from integrations, and authorities from authorities. Never classify a skill as a tool.
Use only the supplied strategies, roles, capabilities and constraints. Include at least one required task.
Do not output markdown, commentary, identity, authority, Project state, Sponsor lane, deadline, policy, assignment, or execution state.`;

type RootResourceContext = Parameters<RootResourceInstaller>[0];

export interface WorkroomExecutionCoordinatorOptions {
  readonly projectRoot: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: RootResourceContext['resources'];
  readonly lifecycle: RootResourceContext['lifecycle'];
  readonly handoff: RootResourceContext['handoff'];
  readonly snapshots: SnapshotReader;
  readonly im: ImRuntime;
  readonly selfDelivery?: SelfDeliveryHostConfiguration;
  readonly ingress: CapabilityIngress;
  readonly agent: AgentRuntimeFoundation;
  readonly runtime: WorkroomRuntimeFoundation;
  readonly profiles: WorkroomProfileCoordinator;
  readonly governance: WorkroomDataGovernanceCoordinator;
  readonly persistence: WorkroomPersistenceCoordinator;
  readonly acceptance: WorkroomAcceptanceCoordinator;
}

/** Owns Portfolio, projection, assignment, scheduler, preemption, and remote callback runtimes. */
export class WorkroomExecutionCoordinator {
  readonly projectionRepository: FileWorkroomProjectionRepository;
  readonly projectionReplyResolver: WorkroomProjectionReplyResolver;
  readonly portfolioSponsorControl: AgentHostPortfolioSponsorControlPort;

  constructor(options: WorkroomExecutionCoordinatorOptions) {
    const { generation, signal, resources, lifecycle, handoff, ingress } = options;
    if (!resources.has(outboundMessageToken)) {
      throw new Error('Workroom Execution requires the generation-owned Outbound Message Port');
    }
    const service = options.agent.service;
    const composedRuntime = options.agent.composition;
    const listGenerationBindings = () => options.agent.listBindings();
    const workroomStateRoot = options.persistence.stateRoot;
    const assignmentAuthorityGrants = options.persistence.assignmentAuthorityGrants;
    const portfolioControlOutbox = options.persistence.portfolioControlOutbox;
    const workroomJournal = options.runtime.journal;
    const workroomCatalog = options.runtime.catalog;
    const workroomKernel = options.runtime.kernel;
    const projectProfiles = options.profiles.profiles;
    const governedOutbound = options.governance.governedOutbound;
    const dataLifecycle = options.governance.lifecycle;
    const workroomReports = options.acceptance.reports;
    if (!resources.has(portfolioJournalRepositoryToken)) {
      resources.provide(
        portfolioJournalRepositoryToken,
        new FilePortfolioJournalRepository(join(workroomStateRoot, 'portfolio-journal')),
      );
    }
    if (!resources.has(portfolioControlOutboxRepositoryToken)) {
      resources.provide(portfolioControlOutboxRepositoryToken, portfolioControlOutbox);
    }
    installLocalWorkroomPortfolioAuthorities({
      generation,
      resources,
      catalog: workroomCatalog,
      profiles: projectProfiles,
      portfolioJournal: resources.use(portfolioJournalRepositoryToken),
    });
    if (!resources.has(portfolioSponsorCommandToken)) {
      const portfolioSponsor = new WorkroomPortfolioSponsorRuntime({
        generation,
        repository: resources.use(portfolioJournalRepositoryToken),
        authority: createCatalogPortfolioSponsorCommandAuthority(workroomCatalog),
      });
      resources.provide(portfolioSponsorCommandToken, portfolioSponsor);
    }
    const portfolioSponsor = resources.use(portfolioSponsorCommandToken);
    const projectionReader = createGovernedPortfolioSponsorProjectionReader({
      source: portfolioSponsor,
      authority: createCatalogGovernedWorkroomProjectionAuthority({
        catalog: workroomCatalog,
        governance: options.runtime.governance,
      }),
    });
    this.portfolioSponsorControl = Object.freeze({
      read: projectionReader.read,
      execute: portfolioSponsor.execute.bind(portfolioSponsor),
    });
    const portfolioSponsorProjectionSource: Readonly<{
      listPortfolioIds(): Promise<readonly string[]>;
      read(portfolioId: string): Promise<PortfolioSponsorProjection>;
    }> = Object.freeze({
      listPortfolioIds: () => resources.use(portfolioJournalRepositoryToken).listPortfolioIds(),
      read: (portfolioId: string) => portfolioSponsor.read(portfolioId),
    });
    const portfolioCapacity = resources.has(portfolioCapacityRuntimeToken)
      ? resources.use(portfolioCapacityRuntimeToken)
      : new GenerationOwnedPortfolioCapacityRuntime({
        generation,
        repository: resources.use(portfolioJournalRepositoryToken),
        policyAuthority: Object.freeze({
          resolve: async (portfolioId: string) => resources.has(portfolioPolicyAuthorityToken)
            ? await resources.use(portfolioPolicyAuthorityToken).resolve(portfolioId)
            : undefined,
        }),
        bundleAuthority: Object.freeze({
          validate: async (input: Parameters<PortfolioAtomicBundleAuthorityPort['validate']>[0]) => resources.has(portfolioAtomicBundleAuthorityToken)
            ? await resources.use(portfolioAtomicBundleAuthorityToken).validate(input)
            : undefined,
        }),
        kernelAuthority: new WorkroomPortfolioAssignmentFailureAuthority({
          generation,
          portfolioJournal: resources.use(portfolioJournalRepositoryToken),
          workroomJournal,
          fallback: Object.freeze({
            authorize: async (input: Parameters<PortfolioKernelCommandAuthorityPort['authorize']>[0]) => resources.has(portfolioKernelCommandAuthorityToken)
              ? await resources.use(portfolioKernelCommandAuthorityToken).authorize(input)
              : undefined,
          }),
        }),
        usageAuthority: Object.freeze({
          authenticate: async (input: Parameters<PortfolioUsageGatewayAuthorityPort['authenticate']>[0]) => resources.has(portfolioUsageGatewayAuthorityToken)
            ? await resources.use(portfolioUsageGatewayAuthorityToken).authenticate(input)
            : undefined,
        }),
        clockAuthority: Object.freeze({
          read: async (input: Parameters<PortfolioClockAuthorityPort['read']>[0]) => resources.has(portfolioClockAuthorityToken)
            ? await resources.use(portfolioClockAuthorityToken).read(input)
            : undefined,
        }),
      });
    if (!resources.has(portfolioCapacityRuntimeToken)) {
      resources.provide(portfolioCapacityRuntimeToken, portfolioCapacity);
    }
    if (!resources.has(workroomSchedulerCapacityRequestToken)) {
      resources.provide(workroomSchedulerCapacityRequestToken, portfolioCapacity);
    }
    const schedulerDispatch = installWorkroomSchedulerPortfolioDispatchResources({
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
    if (options.snapshots && !resources.has(workroomLocalAssignmentAuthorityToken)) {
      resources.provide(workroomLocalAssignmentAuthorityToken, Object.freeze({
        resolveLocal: async (
          input: Parameters<GenerationOwnedWorkroomAssignmentAuthorityProvider['resolveLocal']>[0],
        ) => {
          const lease = options.snapshots!.acquire();
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
    const projectionRepository = new FileWorkroomProjectionRepository(
      join(workroomStateRoot, 'workroom-projections'),
    );
    const projectionReplyResolver = new WorkroomProjectionReplyResolver({
      repository: projectionRepository,
      runState: Object.freeze({
        read: async (projectId: string, runId: string) =>
          await workroomKernel.read(projectId, runId),
      }),
    });
    const projectionRuntime = new WorkroomProjectionRuntime({
      catalog: workroomCatalog,
      journal: workroomJournal,
      repository: projectionRepository,
      outbound: createWorkroomProjectionOutboundMessageServicePort(
        resources.use(outboundMessageToken),
        rootPluginId(),
      ),
      workerId: `workroom-projection:${randomUUID()}`,
      leaseMs: 30_000,
      maxRunsPerTick: 64,
      maxDeliveriesPerTick: 32,
      governance: governedOutbound.projection,
      renewWorkroomBinding: async (projectId, catalog, operationSignal) => {
        operationSignal.throwIfAborted();
        const definition = catalog.definitions[projectId];
        if (!definition) return;
        const conversation = resolveCatalogWorkroomProjectionConversation(
          definition,
          options.im.listEndpoints(),
        );
        if (!conversation) return;
        await ensureCatalogWorkroomProjectionBinding({
          repository: projectionRepository,
          catalog,
          projectId,
          conversation,
          interactionBindingRevision: 1,
          endpoints: options.im.listEndpoints(),
        });
      },
      resolveSponsorConversation: (_projectId, definition) =>
        resolveCatalogSponsorProjectionConversation(definition, options.im.listEndpoints()),
      ...(dataLifecycle ? { lifecycleOverdue: dataLifecycle.overdue } : {}),
      ...(portfolioSponsorProjectionSource
        ? { portfolioSponsor: portfolioSponsorProjectionSource }
        : {}),
    });
    const projectionScheduler = new WorkroomProjectionScheduler({
      runtime: projectionRuntime,
      intervalMs: 1_000,
      onError: error => logger.error(formatCompact({
        op: 'workroom_projection_tick',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    lifecycle.add(() => projectionScheduler.dispose());
    handoff.add({
      activateNext: signal => {
        signal.throwIfAborted();
        projectionScheduler.start();
      },
    });
    if (options.snapshots && resources.has(workroomLocalAssignmentAuthorityToken)) {
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
          const lease = options.snapshots!.acquire();
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
      lifecycle.add(schedulerDispatch.routes.register({
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
    const workroomScheduler = new WorkroomSchedulerRuntime({
      journal: workroomJournal,
      commands: createWorkroomSchedulerKernelCommandPort(workroomKernel),
      resolveSupply: () => resources.has(workroomSchedulerDispatchSupplyToken)
        ? resources.use(workroomSchedulerDispatchSupplyToken)
        : undefined,
      unavailableControl: Object.freeze({
        block: async decision => {
          const state = await workroomKernel.read(decision.projectId, decision.runId);
          const task = state.tasks[decision.taskKey];
          const blockerId = `scheduler-supply:${decision.decisionId}`;
          if (!task || task.revision !== decision.taskRevision || task.status !== 'ready') return;
          if (task.blockers.some(blocker => blocker.id === blockerId)) return;
          await workroomKernel.execute(decision.projectId, decision.runId, {
            type: 'block_task',
            taskKey: decision.taskKey,
            blockerId,
            kind: 'capability',
            owner: 'workroom-scheduler-assignment-supply',
            reason: 'No exact generation-owned Assignment route or trusted Portfolio Capacity authority is available',
            deadline: state.now + 300_000,
          });
        },
        recover: async decision => {
          const state = await workroomKernel.read(decision.projectId, decision.runId);
          const task = state.tasks[decision.taskKey];
          const blockerId = `scheduler-supply:${decision.decisionId}`;
          if (!task || task.revision !== decision.taskRevision) return;
          if (!task.blockers.some(blocker => blocker.id === blockerId
            && blocker.owner === 'workroom-scheduler-assignment-supply')) return;
          await workroomKernel.execute(decision.projectId, decision.runId, {
            type: 'resolve_blocker',
            taskKey: decision.taskKey,
            blockerId,
          });
        },
      }),
      intervalMs: 1_000,
      onError: error => {
        // Missing exact route/Portfolio authority is an expected fail-closed
        // state; no Assignment is claimed and a later provider can recover
        // from the same Journal.
        if (error instanceof WorkroomSchedulerSupplyUnavailableError) return;
        logger.error(formatCompact({
          op: 'workroom_scheduler_tick',
          error: error instanceof Error ? error.message : String(error),
        }));
      },
    });
    resources.provide(workroomSchedulerRuntimeToken, workroomScheduler);
    lifecycle.add(() => workroomScheduler.dispose());
    handoff.add({
      activateNext: signal => {
        signal.throwIfAborted();
        workroomScheduler.start();
      },
    });
    const workroomPreemption = new WorkroomPreemptionRuntime({
      journal: workroomJournal,
      delivery: new WorkroomAssignmentCheckpointDelivery({
        kernel: workroomKernel,
        resolveProvider: () => resources.has(workroomCheckpointDeliveryProviderToken)
          ? resources.use(workroomCheckpointDeliveryProviderToken)
          : undefined,
      }),
      unavailableControl: Object.freeze({
        block: async (preemption: WorkroomPreemptionState, reason: string) => {
          const state = await workroomKernel.read(preemption.projectId, preemption.runId);
          const task = state.tasks[preemption.reservedTaskKey];
          const blockerId = `checkpoint-delivery:${preemption.decisionId}`;
          if (!task || task.revision !== preemption.reservedTaskRevision
            || !['ready', 'blocked'].includes(task.status)
            || task.blockers.some(blocker => blocker.id === blockerId)) return;
          await workroomKernel.execute(preemption.projectId, preemption.runId, {
            type: 'block_task',
            taskKey: preemption.reservedTaskKey,
            blockerId,
            kind: 'capability',
            owner: 'workroom-checkpoint-delivery',
            reason: `Typed Assignment checkpoint transport unavailable: ${reason}`,
            deadline: preemption.deadline,
          });
        },
        recover: async (preemption: WorkroomPreemptionState) => {
          const state = await workroomKernel.read(preemption.projectId, preemption.runId);
          const task = state.tasks[preemption.reservedTaskKey];
          const blockerId = `checkpoint-delivery:${preemption.decisionId}`;
          if (!task || task.revision !== preemption.reservedTaskRevision
            || !task.blockers.some(blocker => blocker.id === blockerId
              && blocker.owner === 'workroom-checkpoint-delivery')) return;
          await workroomKernel.execute(preemption.projectId, preemption.runId, {
            type: 'resolve_blocker',
            taskKey: preemption.reservedTaskKey,
            blockerId,
          });
        },
      }),
      intervalMs: 1_000,
      onError: error => logger.error(formatCompact({
        op: 'workroom_preemption_tick',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    resources.provide(workroomPreemptionRuntimeToken, workroomPreemption);
    if (!resources.has(workroomPortfolioCheckpointAckAdapterToken)) {
      resources.provide(
        workroomPortfolioCheckpointAckAdapterToken,
        new WorkroomPortfolioCheckpointAckAdapter(
          new JournalWorkroomPreemptionCheckpointAckReader(workroomJournal),
        ),
      );
    }
    const portfolioIssuances = new KernelPortfolioGrantAssignmentIssuance(workroomKernel);
    const portfolioGrantAuthority = new PortfolioGrantAssignmentAuthority({
      portfolioJournal: resources.use(portfolioJournalRepositoryToken),
      workroomJournal,
      catalog: workroomCatalog,
      schedulerRoute: schedulerDispatch.routes,
      issuances: portfolioIssuances,
    });
    const portfolioGrantAssignments = new WorkroomPortfolioGrantAssignmentSaga({
      generation,
      capacity: portfolioCapacity,
      bindings: portfolioGrantAuthority,
      issuances: portfolioIssuances,
    });
    const portfolioControlWorker = installWorkroomPortfolioControlWorker({
      generation,
      signal,
      resources,
      journal: resources.use(portfolioJournalRepositoryToken),
      outbox: resources.use(portfolioControlOutboxRepositoryToken),
      capacity: portfolioCapacity,
      route: portfolioGrantAuthority.routeAuthority,
      grantAssignments: portfolioGrantAssignments,
      checkpointAcks: resources.use(workroomPortfolioCheckpointAckAdapterToken),
      intervalMs: 1_000,
      autoStart: false,
      onError: error => logger.error(formatCompact({
        op: 'portfolio_control_tick',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    lifecycle.add(() => portfolioControlWorker.dispose());
    handoff.add({
      activateNext: operationSignal => {
        operationSignal.throwIfAborted();
        portfolioControlWorker.start();
      },
    });
    lifecycle.add(() => workroomPreemption.dispose());
    handoff.add({
      activateNext: signal => {
        signal.throwIfAborted();
        workroomPreemption.start();
      },
    });
    resources.provide(
      workroomRemoteCallbackRuntimeToken,
      createWorkroomRemoteCallbackRuntime({
        kernel: workroomKernel,
        stateRoot: workroomStateRoot,
        governance: governedOutbound.remote,
      }),
    );
    this.projectionRepository = projectionRepository;
    this.projectionReplyResolver = projectionReplyResolver;
  }
}
