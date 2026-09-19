import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  FileProjectMemoryApplicationRepository,
  FileWorkroomTaskReportStore,
  type WorkroomTaskReportPayloadReadInput,
  type WorkroomTaskReportPayloadWriteInput,
} from '@zhin.js/agent';
import {
  FileWorkroomAcceptanceProjectionRepository,
  FileWorkroomContextReleaseJournal,
  FileWorkroomEphemeralContextDisposer,
  FileWorkroomKernelRiskHeaderRepository,
  ImmutableWorkroomTypedCheckRegistry,
  WorkroomAcceptanceProfileProjectionRuntime,
  WorkroomAcceptedSourceRuntime,
  WorkroomArtifactRiskHeaderResolver,
  WorkroomAuthenticatedArtifactRiskProducer,
  createGenerationRemoteContextReleaseCapability,
  createRoutedWorkroomEphemeralContextProvider,
  installWorkroomAcceptanceResources,
  installWorkroomEffectResources,
  workroomAcceptanceProjectionPayloadToken,
  workroomAcceptanceProjectionSourceAuthorityToken,
  workroomAcceptedReportReaderToken,
  workroomAcceptedSourceRecallToken,
  workroomAcceptedSourceRuntimeToken,
  workroomExecutionContextReleaseToken,
  workroomProjectMemorySchemaAuthorityToken,
  workroomRemoteContextReleaseProviderToken,
  workroomTaskReportPayloadToken,
  workroomTypedAcceptanceCheckRegistryToken,
  workroomAcceptanceProjectionSourceBindingDigest,
  type AgentHostEffectSponsorControlPort,
  type WorkroomAcceptanceProjectionAuthorityPort,
  type WorkroomEphemeralContextReleaseCapabilityPort,
  type WorkroomEphemeralContextRoutePort,
  type WorkroomExecutionContextReleasePort,
  type WorkroomProjectMemorySchemaAuthorityPort,
  type WorkroomRiskHeaderProducerAuthorityPort,
} from '@zhin.js/agent/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import type { WorkroomDataGovernanceCoordinator } from './workroom-data-governance-coordinator.js';
import type { WorkroomProfileCoordinator } from './workroom-profile-coordinator.js';
import type { WorkroomRuntimeFoundation } from './workroom-runtime-foundation.js';

const logger = getLogger('agent');
type RootResourceContext = Parameters<RootResourceInstaller>[0];

export interface WorkroomAcceptanceCoordinatorOptions {
  readonly projectRoot: string;
  readonly stateRoot: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: RootResourceContext['resources'];
  readonly lifecycle: RootResourceContext['lifecycle'];
  readonly handoff: RootResourceContext['handoff'];
  readonly runtime: WorkroomRuntimeFoundation;
  readonly profiles: WorkroomProfileCoordinator;
  readonly governance: WorkroomDataGovernanceCoordinator;
  readonly effect: ReturnType<typeof installWorkroomEffectResources>;
  readonly ephemeralAssignmentContext: Readonly<{
    releaseTask(input: Parameters<WorkroomEphemeralContextReleaseCapabilityPort['release']>[0]['request']['eligibility']): Readonly<{
      receiptRef: string;
    }>;
  }>;
}

/** Owns acceptance projections, risk evidence, context release, and accepted-source replay. */
export class WorkroomAcceptanceCoordinator {
  readonly reports: FileWorkroomTaskReportStore;
  readonly effectSponsorControl: AgentHostEffectSponsorControlPort;

  constructor(options: WorkroomAcceptanceCoordinatorOptions) {
    const { generation, signal, resources, lifecycle, handoff } = options;
    const workroomStateRoot = options.stateRoot;
    const workroomJournal = options.runtime.journal;
    const workroomCatalog = options.runtime.catalog;
    const workroomKernel = options.runtime.kernel;
    const projectProfiles = options.profiles.profiles;
    const acceptanceProfileSource = options.profiles.acceptanceSource;
    const dataGovernanceCoordinator = options.governance;
    const effectComposition = options.effect;
    const ephemeralAssignmentContext = options.ephemeralAssignmentContext;
    const workroomReports = new FileWorkroomTaskReportStore(
      join(workroomStateRoot, 'workroom-task-reports'),
      Object.freeze({
        write: async (input: WorkroomTaskReportPayloadWriteInput, operationSignal: AbortSignal) => {
          if (!resources.has(workroomTaskReportPayloadToken)) {
            throw new Error('Governed Workroom Task Report Payload Port is unavailable');
          }
          return await resources.use(workroomTaskReportPayloadToken).write(input, operationSignal);
        },
        read: async (input: WorkroomTaskReportPayloadReadInput, operationSignal: AbortSignal) => {
          if (!resources.has(workroomTaskReportPayloadToken)) {
            throw new Error('Governed Workroom Task Report Payload Port is unavailable');
          }
          return await resources.use(workroomTaskReportPayloadToken).read(input, operationSignal);
        },
      }),
      signal,
    );
    dataGovernanceCoordinator.bindReportPayloadVerifier(workroomReports);
    if (!resources.has(workroomAcceptedReportReaderToken)) {
      resources.provide(workroomAcceptedReportReaderToken, workroomReports);
    }
    const acceptanceProjectionAuthority: WorkroomAcceptanceProjectionAuthorityPort = Object.freeze({
      async authorize(
        candidate: Parameters<WorkroomAcceptanceProjectionAuthorityPort['authorize']>[0],
      ) {
        if (!resources.has(workroomAcceptanceProjectionSourceAuthorityToken)) return false;
        const bindingDigest = workroomAcceptanceProjectionSourceBindingDigest(candidate);
        const trusted = await resources.use(workroomAcceptanceProjectionSourceAuthorityToken).resolve({
          projectId: candidate.projection.projectId,
          projectionDigest: candidate.projection.digest,
          source: Object.freeze({ ...candidate.source, bindingDigest }),
        }, signal);
        return Boolean(trusted && trusted.verification === 'verified'
          && trusted.kind === candidate.source.kind && trusted.ref === candidate.source.ref
          && trusted.digest === candidate.source.digest && trusted.issuer === candidate.source.issuer
          && trusted.issuerDigest === candidate.source.issuerDigest
          && trusted.revision === candidate.source.revision
          && trusted.bindingDigest === bindingDigest);
      },
    });
    if (!resources.has(workroomAcceptanceProjectionPayloadToken)) {
      throw new Error('Governed Workroom Acceptance Projection Payload Port is unavailable');
    }
    const acceptanceProjections = new FileWorkroomAcceptanceProjectionRepository({
      directory: join(workroomStateRoot, 'workroom-acceptance-projections'),
      payloads: resources.use(workroomAcceptanceProjectionPayloadToken),
      authority: acceptanceProjectionAuthority,
      signal,
    });
    const acceptanceProjects = Object.freeze({
      listProjectIds: async () => Object.freeze(Object.entries((await workroomCatalog.read()).definitions)
        .filter(([, definition]) => definition.enabled !== false)
        .map(([projectId]) => projectId)),
    });
    const acceptanceProfileProjector = new WorkroomAcceptanceProfileProjectionRuntime({
      source: acceptanceProfileSource,
      repository: acceptanceProjections,
      projects: acceptanceProjects,
      signal,
      intervalMs: 1_000,
      onError: error => logger.error(formatCompact({
        op: 'workroom_acceptance_profile_projector',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    lifecycle.add(() => acceptanceProfileProjector.dispose());
    handoff.add({
      activateNext: operationSignal => {
        operationSignal.throwIfAborted();
        acceptanceProfileProjector.start();
      },
    });
    const resolveCurrentAssignmentIssuance = async (input: Readonly<{
      projectId: string;
      runId: string;
      taskKey: string;
    }>) => {
      const [local, remote] = await Promise.all([
        workroomKernel.listLocalAssignmentIssuances(),
        workroomKernel.listRemoteAssignmentIssuances(),
      ]);
      const matching = [
        ...local.map(issuance => ({ kind: 'local' as const, issuance })),
        ...remote.map(issuance => ({ kind: 'remote' as const, issuance })),
      ].filter(({ issuance }) => {
        const envelope = issuance.envelope;
        return envelope.projectId === input.projectId && envelope.runId === input.runId
          && envelope.taskKey === input.taskKey
          && issuance.state.tasks[input.taskKey]?.currentAssignmentId === envelope.assignmentId;
      });
      return matching.length === 1 ? matching[0] : undefined;
    };
    const artifactRiskProducer = new WorkroomAuthenticatedArtifactRiskProducer({
      generation,
      reports: workroomReports,
      effectJournal: effectComposition.journal,
    });
    const riskHeaderAuthority: WorkroomRiskHeaderProducerAuthorityPort = Object.freeze({
      async authorize(
        publication: Parameters<WorkroomRiskHeaderProducerAuthorityPort['authorize']>[0],
      ) {
        if (publication.producer.generation !== generation) return false;
        if (publication.producer.kind === 'workspace-artifact') {
          return await artifactRiskProducer.authorize(publication);
        }
        if (publication.producer.kind === 'effect-ledger') {
          if (publication.producer.issuer !== 'workroom-effect-ledger') return false;
          const events = await effectComposition.journal.read(publication.header.scope.projectId);
          return events.some(event => {
            if (event.type !== 'effect.intent_recorded') return false;
            const intent = event.payload.intent;
            return Boolean(intent && typeof intent === 'object'
              && 'id' in intent && intent.id === publication.producer.factRef
              && 'digest' in intent && intent.digest === publication.producer.factDigest
              && event.digest === publication.producer.issuerDigest);
          });
        }
        if (publication.producer.issuer !== 'workroom-kernel') return false;
        const current = await resolveCurrentAssignmentIssuance(publication.header.scope);
        if (!current) return false;
        const fact = publication.producer.kind === 'kernel-plan'
          ? current.issuance.envelope.plan
          : current.issuance.envelope.capabilitySnapshot;
        return fact.ref === publication.producer.factRef
          && fact.digest === publication.producer.factDigest
          && current.issuance.envelope.digest === publication.producer.issuerDigest;
      },
    });
    const riskHeaders = new FileWorkroomKernelRiskHeaderRepository({
      directory: join(workroomStateRoot, 'workroom-risk-headers'),
      generation,
      authority: riskHeaderAuthority,
    });
    const artifactRiskHeaders = new WorkroomArtifactRiskHeaderResolver({
      repository: riskHeaders,
      producer: artifactRiskProducer,
    });
    const typedChecks = resources.has(workroomTypedAcceptanceCheckRegistryToken)
      ? resources.use(workroomTypedAcceptanceCheckRegistryToken)
      : new ImmutableWorkroomTypedCheckRegistry([]);
    const contextRoutes: WorkroomEphemeralContextRoutePort = Object.freeze({
      async resolve(eligibility: Parameters<WorkroomEphemeralContextRoutePort['resolve']>[0]) {
        const current = await resolveCurrentAssignmentIssuance(eligibility);
        if (!current) return undefined;
        return Object.freeze({
          kind: current.kind,
          ref: `kernel-assignment:${current.issuance.envelope.assignmentId}`,
          digest: current.issuance.envelope.digest,
        });
      },
    });
    const localContextCapability: WorkroomEphemeralContextReleaseCapabilityPort = Object.freeze({
      async release(
        input: Parameters<WorkroomEphemeralContextReleaseCapabilityPort['release']>[0],
        operationSignal: AbortSignal,
      ) {
        operationSignal.throwIfAborted();
        const receipt = ephemeralAssignmentContext.releaseTask(input.request.eligibility);
        return Object.freeze({
          status: 'released' as const,
          receiptRef: `${receipt.receiptRef}:route:${input.route.digest}`,
          authenticatedBy: `local-assignment-context-generation:${generation}`,
        });
      },
      async reconcile(
        input: Parameters<WorkroomEphemeralContextReleaseCapabilityPort['reconcile']>[0],
        operationSignal: AbortSignal,
      ) {
        operationSignal.throwIfAborted();
        const receipt = ephemeralAssignmentContext.releaseTask(input.request.eligibility);
        return Object.freeze({
          status: 'released' as const,
          receiptRef: `${receipt.receiptRef}:route:${input.route.digest}`,
          authenticatedBy: `local-assignment-context-generation:${generation}`,
        });
      },
    });
    const contextIdentity = (kind: 'local' | 'remote') => Object.freeze({
      kind,
      id: `${kind}-assignment-context-generation:${generation}`,
      digest: `sha256:${createHash('sha256').update(JSON.stringify({
        version: 1, kind, generation,
      })).digest('hex')}`,
    });
    const contextConsumer = new FileWorkroomEphemeralContextDisposer({
      directory: join(workroomStateRoot, 'workroom-ephemeral-context-release'),
      signal,
      providers: Object.freeze([
        createRoutedWorkroomEphemeralContextProvider({
          identity: contextIdentity('local'), routes: contextRoutes, capability: localContextCapability,
        }),
        createRoutedWorkroomEphemeralContextProvider({
          identity: contextIdentity('remote'),
          routes: contextRoutes,
          capability: createGenerationRemoteContextReleaseCapability(() =>
            resources.has(workroomRemoteContextReleaseProviderToken)
              ? resources.use(workroomRemoteContextReleaseProviderToken)
              : undefined),
        }),
      ]),
    });
    const acceptanceComposition = installWorkroomAcceptanceResources({
      projectRoot: options.projectRoot,
      generation,
      signal,
      resources,
      profiles: projectProfiles,
      catalog: workroomCatalog,
      journal: workroomJournal,
      reports: workroomReports,
      projections: acceptanceProjections,
      riskHeaders: artifactRiskHeaders,
      checks: typedChecks.list(),
      contextConsumer,
      effectJournal: effectComposition.journal,
      runState: Object.freeze({
        read: (projectId: string, runId: string) => workroomKernel.read(projectId, runId),
      }),
      projects: acceptanceProjects,
      projectorIntervalMs: 1_000,
      onProjectorError: error => logger.error(formatCompact({
        op: 'workroom_effect_authorization_projector',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    this.effectSponsorControl = Object.freeze({
      decide: (
        command: Parameters<AgentHostEffectSponsorControlPort['decide']>[0],
        authenticatedPrincipal: Parameters<AgentHostEffectSponsorControlPort['decide']>[1],
      ) => acceptanceComposition.effectSponsorControl.decide({
        ...structuredClone(command),
        principalId: authenticatedPrincipal.principalId,
      }),
    });
    lifecycle.add(() => acceptanceComposition.projectorRuntime.dispose());
    handoff.add({
      activateNext: operationSignal => {
        operationSignal.throwIfAborted();
        acceptanceComposition.projectorRuntime.start();
      },
    });
    const acceptedSourceRuntime = new WorkroomAcceptedSourceRuntime({
      journal: workroomJournal,
      repository: new FileProjectMemoryApplicationRepository(
        join(workroomStateRoot, 'workroom-project-memory'),
      ),
      reports: workroomReports,
      schemas: Object.freeze({
        resolve: async (input: Parameters<WorkroomProjectMemorySchemaAuthorityPort['resolve']>[0]) => {
          if (!resources.has(workroomProjectMemorySchemaAuthorityToken)) {
            throw new Error('Generation/Profile Project Memory Schema authority is unavailable');
          }
          return await resources.use(workroomProjectMemorySchemaAuthorityToken).resolve(input);
        },
      }),
      release: Object.freeze({
        release: async (input: Parameters<WorkroomExecutionContextReleasePort['release']>[0]) => {
          if (!resources.has(workroomExecutionContextReleaseToken)) {
            throw new Error('Execution Context Release authority is unavailable');
          }
          return await resources.use(workroomExecutionContextReleaseToken).release(input);
        },
      }),
      releases: new FileWorkroomContextReleaseJournal(
        join(workroomStateRoot, 'workroom-context-release'),
      ),
      intervalMs: 1_000,
      onError: error => logger.error(formatCompact({
        op: 'workroom_accepted_source',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    resources.provide(workroomAcceptedSourceRuntimeToken, acceptedSourceRuntime);
    if (!resources.has(workroomAcceptedSourceRecallToken)) {
      resources.provide(workroomAcceptedSourceRecallToken, acceptedSourceRuntime);
    }
    lifecycle.add(() => acceptedSourceRuntime.dispose());
    handoff.add({
      activateNext: operationSignal => {
        operationSignal.throwIfAborted();
        acceptedSourceRuntime.start();
      },
    });
    this.reports = workroomReports;
  }
}
