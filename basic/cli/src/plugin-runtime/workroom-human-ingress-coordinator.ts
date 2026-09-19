import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  ConversationEventHumanIngressSourceReader,
  FileHumanIngressApplicationRepository,
  FileHumanIngressProposalRepository,
  FileInteractionSpaceBindingRepository,
  HumanIngressApplicationService,
  InteractionSpaceRouter,
  ProductionHumanIngressOrchestratorPort,
  createPlanGateHumanIngressControlPort,
  resolveWorkroomBotIdentity,
  workroomProjectionBindingKey,
  type HumanIngressOrchestratorProposalPort,
} from '@zhin.js/agent';
import {
  createGenerationHumanIngressPlanningPort,
  createPortfolioSponsorHumanIngressControlPort,
  createProjectionHumanIngressTargetResolver,
  createWorkroomDataLifecycleHumanIngressControlPort,
  digestWorkroomCatalogProjectBinding,
  portfolioSponsorCommandToken,
  workroomHumanIngressPlanningToken,
  workroomProjectionCatalogBindingDigest,
  type WorkroomDataLifecycleConsoleControlPort,
} from '@zhin.js/agent/runtime';
import type { ImRuntime, Message } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { conversationRefKey } from '@zhin.js/im-contract';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { adapterLiveEndpointId, capabilityLocalName } from './agent-turn-request.js';
import { stringMetadata } from './agent-turn-content.js';
import type { WorkroomExecutionCoordinator } from './workroom-execution-coordinator.js';
import {
  WorkroomHumanIngressPreRoute,
  createCatalogWorkroomSpace,
  resolveWorkroomHumanIntent,
  type WorkroomAgentTurnContinuation,
} from './workroom-human-ingress-route.js';
import type { WorkroomPersistenceCoordinator } from './workroom-persistence-coordinator.js';
import type { WorkroomProfileCoordinator } from './workroom-profile-coordinator.js';
import {
  catalogSpaceSourceDigest,
  classifyWorkroomIngressSource,
  createSponsorProjectionControlTargetResolver,
  ensureCatalogWorkroomProjectionBinding,
  resolveIndexedProjectionReply,
  sponsorRoomProjectId,
} from './workroom-projection.js';
import type { WorkroomRuntimeFoundation } from './workroom-runtime-foundation.js';

const logger = getLogger('agent');
type RootResourceContext = Parameters<RootResourceInstaller>[0];

export interface WorkroomHumanIngressCoordinatorOptions {
  readonly signal: AbortSignal;
  readonly resources: RootResourceContext['resources'];
  readonly lifecycle: RootResourceContext['lifecycle'];
  readonly im: ImRuntime;
  readonly port?: HumanIngressOrchestratorProposalPort;
  readonly runtime: WorkroomRuntimeFoundation;
  readonly profiles: WorkroomProfileCoordinator;
  readonly persistence: WorkroomPersistenceCoordinator;
  readonly execution: WorkroomExecutionCoordinator;
  readonly dataLifecycleControl: Readonly<{
    current?: WorkroomDataLifecycleConsoleControlPort;
  }>;
}

/** Owns durable human ingress authorization, proposal application, recovery, and turn handoff. */
export class WorkroomHumanIngressCoordinator {
  readonly #route: WorkroomHumanIngressPreRoute;
  readonly #recover: () => Promise<void>;

  private constructor(route: WorkroomHumanIngressPreRoute, recover: () => Promise<void>) {
    this.#route = route;
    this.#recover = recover;
  }

  static async create(options: WorkroomHumanIngressCoordinatorOptions): Promise<WorkroomHumanIngressCoordinator> {
    const { signal, resources, lifecycle } = options;
    signal.throwIfAborted();
    const workroomStateRoot = options.persistence.stateRoot;
    const workroomCatalog = options.runtime.catalog;
    const workroomKernel = options.runtime.kernel;
    const profileRunPinWriter = options.profiles.runPinWriter;
    const projectionRepository = options.execution.projectionRepository;
    const projectionReplyResolver = options.execution.projectionReplyResolver;
    let recoverHumanIngress = async (): Promise<void> => {};
    const interactionSpaceBindings = new FileInteractionSpaceBindingRepository(
      join(workroomStateRoot, 'interaction-space-bindings'),
    );
    const humanIngressProposals = new FileHumanIngressProposalRepository(
      join(workroomStateRoot, 'workroom-human-ingress'),
    );
    const humanIngressApplications = new FileHumanIngressApplicationRepository(
      join(workroomStateRoot, 'workroom-human-ingress-application'),
    );
    const interactionSpaceRouter = new InteractionSpaceRouter(interactionSpaceBindings);
    const productionHumanIngressPort = new ProductionHumanIngressOrchestratorPort({
      sources: new ConversationEventHumanIngressSourceReader(() => options.im.conversationEvents),
      kernel: workroomKernel,
      resolveProject: async projectId => {
        const snapshot = await workroomCatalog.read();
        const definition = snapshot.definitions[projectId];
        if (!definition || definition.enabled === false || !definition.conversation) return null;
        const agent = definition.conversation.agent;
        if (!definition.members.some(member => member.agent === agent && member.role === 'orchestrator')) {
          throw new Error(`Workroom Catalog ${projectId} has no valid Orchestrator binding`);
        }
        const projectDigest = digestWorkroomCatalogProjectBinding(definition);
        return Object.freeze({
          orchestratorAgentDefinitionId: agent,
          projectRevision: snapshot.revision,
          projectDigest,
          orchestratorAuthorityDigest: `sha256:${createHash('sha256').update(JSON.stringify({
            projectId,
            projectRevision: snapshot.revision,
            projectDigest,
            agentDefinitionId: agent,
            role: 'orchestrator',
          })).digest('hex')}`,
        });
      },
      authorizeProjectSource: async ({ projectId, proposal, source }) => {
        if (proposal.space === 'sponsor_room') {
          const snapshot = await workroomCatalog.read();
          const definition = snapshot.definitions[projectId];
          const configured = definition?.sponsorConversation;
          if (!definition || definition.enabled === false || !configured) return false;
          const projectionState = await projectionRepository.read();
          const binding = projectionState.bindings[
            workroomProjectionBindingKey(projectId, 'sponsor_room')
          ];
          if (!binding) return false;
          const replyEntry = proposal.projectionReply
            ? projectionState.messageIndex[proposal.projectionReply.messageKey]
            : undefined;
          if (proposal.projectionReply && (!replyEntry
            || replyEntry.projectionId !== proposal.projectionReply.projectionId
            || replyEntry.target.projectId !== proposal.projectionReply.projectId
            || replyEntry.bindingRevision !== proposal.projectionReply.bindingRevision
            || digestInstallerValue(replyEntry.target) !== proposal.projectionReply.targetDigest)) {
            return false;
          }
          return proposal.projectId === projectId
            && proposal.bindingDigest === catalogSpaceSourceDigest(
              projectId, 'sponsor_room', configured,
            )
            && proposal.bindingRevision === binding.bindingRevision
            && binding.catalogBindingDigest === workroomProjectionCatalogBindingDigest(definition)
            && conversationRefKey(source.event.conversation) === conversationRefKey(binding.conversation);
        }
        const decision = await interactionSpaceRouter.resolve({
          conversation: source.event.conversation,
          conversationSequence: source.sequence,
        });
        return decision.status === 'resolved'
          && decision.source === 'binding'
          && decision.projectId === projectId
          && decision.space === proposal.space
          && decision.bindingRevision === proposal.bindingRevision
          && decision.bindingDigest === proposal.bindingDigest;
      },
      planning: resources.has(workroomHumanIngressPlanningToken)
        ? createGenerationHumanIngressPlanningPort(() =>
            resources.has(workroomHumanIngressPlanningToken)
              ? resources.use(workroomHumanIngressPlanningToken)
              : undefined)
        : undefined,
      controls: createPortfolioSponsorHumanIngressControlPort({
        resolve: () => resources.has(portfolioSponsorCommandToken)
          ? resources.use(portfolioSponsorCommandToken)
          : undefined,
        generationSignal: signal,
        fallback: createWorkroomDataLifecycleHumanIngressControlPort({
          resolve: () => options.dataLifecycleControl.current,
          generationSignal: signal,
          fallback: createPlanGateHumanIngressControlPort(workroomKernel),
        }),
      }),
      afterPlanAdmission: input => profileRunPinWriter.afterPlanAdmission(input, signal),
    });
    const humanIngressApplication = new HumanIngressApplicationService({
      proposals: humanIngressProposals,
      applications: humanIngressApplications,
      port: options.port ?? productionHumanIngressPort,
      onError: (error, request) => logger.error(formatCompact({
        op: 'workroom_human_ingress_application',
        projectId: request.identity.projectId,
        proposalId: request.identity.proposalId,
        attempt: request.attempt,
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    let humanIngressRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let humanIngressRetryAt: number | undefined;
    const scheduleHumanIngressRetry = (retryAt: number) => {
      if (signal.aborted) return;
      if (humanIngressRetryAt !== undefined && humanIngressRetryAt <= retryAt) return;
      if (humanIngressRetryTimer) clearTimeout(humanIngressRetryTimer);
      humanIngressRetryAt = retryAt;
      humanIngressRetryTimer = setTimeout(() => {
        humanIngressRetryTimer = undefined;
        humanIngressRetryAt = undefined;
        if (signal.aborted) return;
        void recoverHumanIngress().catch(error => {
          if (signal.aborted) return;
          logger.error(formatCompact({
            op: 'workroom_human_ingress_recovery',
            error: error instanceof Error ? error.message : String(error),
          }));
          scheduleHumanIngressRetry(Date.now() + 5_000);
        });
      }, Math.max(0, retryAt - Date.now()));
      humanIngressRetryTimer.unref?.();
    };
    lifecycle.add(() => {
      if (humanIngressRetryTimer) clearTimeout(humanIngressRetryTimer);
      humanIngressRetryTimer = undefined;
      humanIngressRetryAt = undefined;
    });
    const drainHumanIngressProject = async (projectId: string) => {
      const results = await humanIngressApplication.drain(projectId);
      for (const result of results) {
        if (result.status === 'retry_scheduled') scheduleHumanIngressRetry(result.retryAt);
        if (result.status === 'waiting') scheduleHumanIngressRetry(result.wakeAt);
      }
      return results;
    };
    recoverHumanIngress = async () => {
      const catalog = await workroomCatalog.read();
      for (const projectId of Object.keys(catalog.definitions).sort()) {
        await drainHumanIngressProject(projectId);
      }
    };
    if (!options.persistence.pendingActivation) await recoverHumanIngress();
    const projectionReplyTargets = new WeakMap<Message, Message['message']>();
    const projectionMentionTargets = new WeakMap<Message, Readonly<{
      agentDefinitionId: string;
      candidates: readonly NonNullable<Message['message']>[];
    }>>();
    const workroomHumanIngress = new WorkroomHumanIngressPreRoute({
      bindings: interactionSpaceBindings,
      bindingRouter: interactionSpaceRouter,
      proposals: humanIngressProposals,
      application: Object.freeze({ drain: drainHumanIngressProject }),
      sourceEvents: () => options.im.conversationEvents,
      resolveIntent: resolveWorkroomHumanIntent,
      createTargetResolver: (message, intent, decision) =>
        decision.space === 'sponsor_room' && intent === 'control'
          ? createSponsorProjectionControlTargetResolver({
              projectionRepository,
              message,
              intent,
            })
          : createProjectionHumanIngressTargetResolver({
              resolver: projectionReplyResolver,
              ...(projectionReplyTargets.get(message)
                ? { replyTo: projectionReplyTargets.get(message)! }
                : message.replyTo
                  ? { replyTo: { conversation: message.conversation, id: message.replyTo.id } }
                : {}),
              ...(projectionMentionTargets.get(message)
                ? { mention: projectionMentionTargets.get(message)! }
                : {}),
              intent,
            }),
      onWorkroomResolved: async (message, decision) => {
        const catalog = await workroomCatalog.read();
        await ensureCatalogWorkroomProjectionBinding({
          repository: projectionRepository,
          catalog,
          projectId: decision.projectId,
          conversation: message.conversation,
          interactionBindingRevision: decision.bindingRevision,
          endpoints: options.im.listEndpoints(),
        });
      },
      principalOwner: String(rootPluginId()),
      resolveCatalogSpace: async message => {
        const adapter = capabilityLocalName(String(message.conversation.endpoint.id));
        const endpoint = adapterLiveEndpointId(message);
        const repository = adapter === 'github'
          ? stringMetadata(message.metadata, 'repo')
          : undefined;
        const kind = repository
          ? 'repository' as const
          : message.conversation.kind === 'group' || message.conversation.kind === 'channel'
            ? message.conversation.kind
            : null;
        if (!kind) return null;
        const catalogSnapshot = await workroomCatalog.read();
        const explicitProjectId = sponsorRoomProjectId(message.content);
        const projectionState = await projectionRepository.read();
        const replyEntry = resolveIndexedProjectionReply(message, projectionState.messageIndex);
        // Cross-Endpoint replies carry the inbound Endpoint in Message.replyTo,
        // while the durable projection index is keyed by the speaking Bot's
        // original Endpoint. Preserve that canonical ref for target resolution.
        if (replyEntry) projectionReplyTargets.set(message, replyEntry.message);
        const repliedProjectId = replyEntry?.target.projectId;
        if (explicitProjectId && repliedProjectId && explicitProjectId !== repliedProjectId) {
          return Object.freeze({ status: 'rejected' as const, reason: 'project_conflict' as const });
        }
        let identity: ReturnType<typeof resolveWorkroomBotIdentity>;
        try {
          identity = resolveWorkroomBotIdentity(catalogSnapshot.definitions, {
          adapter,
          endpoint,
          kind,
          id: repository ?? message.conversation.id,
          ...(explicitProjectId ?? repliedProjectId
            ? { projectId: explicitProjectId ?? repliedProjectId }
            : {}),
          });
        } catch (error) {
          if (error instanceof Error && /explicit Project/u.test(error.message)) {
            return Object.freeze({ status: 'rejected' as const, reason: 'project_required' as const });
          }
          throw error;
        }
        if (!identity) return null;
        const definition = catalogSnapshot.definitions[identity.projectId];
        const configured = identity.space === 'workroom'
          ? definition?.conversation
          : definition?.sponsorConversation;
        if (!definition || !configured) {
          throw new Error(`Workroom Catalog ${identity.projectId} has no collaboration space`);
        }
        const sourceDecision = classifyWorkroomIngressSource(definition, {
          adapter,
          endpoint,
          senderId: String(message.sender?.id ?? ''),
          space: identity.space,
          mentioned: message.mentioned === true || message.metadata.mentioned === true,
          // Generic message metadata is not identity authority. Adapter-owned
          // self filtering and exact configured numeric Bot principals remain
          // the trusted echo suppression paths.
          ...(replyEntry ? {
            replySpeakerAgent: replyEntry.speaker.agentDefinitionId,
            replySpeakerRole: replyEntry.speaker.role,
          } : {}),
        });
        if (sourceDecision !== 'accept') {
          return Object.freeze({ status: 'ignored' as const, reason: sourceDecision });
        }
        if (!replyEntry && identity.space === 'workroom' && identity.role !== 'orchestrator'
          && (message.mentioned === true || message.metadata.mentioned === true)) {
          const candidates = Object.values(projectionState.messageIndex)
            .filter(entry => entry.target.projectId === identity.projectId
              && entry.target.agentDefinitionId === identity.agent
              && entry.target.taskKey != null
              && entry.target.assignmentId != null)
            .map(entry => entry.message);
          projectionMentionTargets.set(message, Object.freeze({
            agentDefinitionId: identity.agent,
            candidates: Object.freeze(candidates),
          }));
        }
        const sponsorBinding = identity.space === 'sponsor_room'
          ? projectionState.bindings[workroomProjectionBindingKey(
              identity.projectId, 'sponsor_room',
            )]
          : undefined;
        if (identity.space === 'sponsor_room') {
          if (!sponsorBinding
            || sponsorBinding.catalogBindingDigest !== workroomProjectionCatalogBindingDigest(definition)
            || conversationRefKey(sponsorBinding.conversation) !== conversationRefKey(message.conversation)) {
            return Object.freeze({ status: 'rejected' as const, reason: 'binding_unavailable' as const });
          }
          if (replyEntry && replyEntry.bindingRevision !== sponsorBinding.bindingRevision) {
            return Object.freeze({ status: 'rejected' as const, reason: 'stale_binding' as const });
          }
        }
        const sourceRef = `workroom-catalog:${encodeURIComponent(identity.projectId)}:${identity.space}`;
        return createCatalogWorkroomSpace({
          projectId: identity.projectId,
          // Every human message enters the Orchestrator-owned Project Inbox.
          // identity.agent may be the member Bot Endpoint that received it.
          agentDefinitionId: configured.agent,
          space: identity.space,
          sourceRef,
          sourceDigest: catalogSpaceSourceDigest(identity.projectId, identity.space, configured),
          ...(identity.space === 'sponsor_room'
            ? { bindingRevision: sponsorBinding!.bindingRevision }
            : {}),
        });
      },
    });

    const coordinator = new WorkroomHumanIngressCoordinator(
      workroomHumanIngress,
      () => recoverHumanIngress(),
    );
    return coordinator;
  }

  preRoute(message: Message, conversationSequence: number | undefined): Promise<boolean> {
    return this.#route.preRoute(message, conversationSequence);
  }

  hasAgentTurn(message: Message): boolean {
    return this.#route.hasAgentTurn(message);
  }

  takeAgentTurn(message: Message): WorkroomAgentTurnContinuation | undefined {
    return this.#route.takeAgentTurn(message);
  }

  recover(): Promise<void> {
    return this.#recover();
  }
}

function digestInstallerValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
