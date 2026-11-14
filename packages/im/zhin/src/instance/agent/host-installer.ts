import { randomUUID } from 'node:crypto';
import yaml from 'yaml';
import { createHostOperationResources } from '@zhin.js/agent/runtime';
import {
  describeSnapshotAiProvider,
  listSnapshotAiProviders,
  provideAiProviders,
  ProviderError,
  providerPlanFingerprint,
  reviewProviderPlan,
  type JsonObject,
  type ProviderGraph,
  type ProviderService,
} from '@zhin.js/ai/provider';
import { applyModelCapabilityDefaults, builtinAiProviders } from '@zhin.js/ai/providers';
import type { HostInference } from '@zhin.js/agent/runtime';
import { turnModelPortToken } from '@zhin.js/agent/model-runtime';
import { createOwnerApprovalMigrationProvider } from '@zhin.js/agent/runtime';
import { pluginDataMigrationProviderToken, rootPluginId, type PluginId, type SnapshotReader } from '@zhin.js/plugin-runtime';
import { getProcessPeerRegistry } from '@zhin.js/adapter';
import { resolveHostProtectedPaths } from './host-protected-paths.js';
import { installAgentPersistence } from '@zhin.js/agent/runtime';
import { createSelfChangeTrialOptions } from './self-change-trial.js';
import { createSelfChangeGenerationPorts } from '@zhin.js/agent/runtime';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  createVenueMembershipPort,
  createVenueProjector,
  createVenueRegistry,
  venueProjectorToken,
  venueRegistryToken,
} from '@zhin.js/core';
import {
  groupRuleViolationToken,
  imOperationResourcesToken,
  ingressRouteToken,
  memberWelcomeOwnerToken,
  roomMembershipToken,
  type GroupRuleViolationSink,
  type ImRuntime,
  type MemberWelcomeOwner,
} from '@zhin.js/core/runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import {
  LocalImageAssetStore,
  localImageAssetsToken,
  type AssistantConfig,
  type ContextFile,
  type ApprovalPort,
  hostProtectedPathsToken,
  SelfChangeApplier,
  SelfChangeApprovals,
  SelfChangeStore,
  selfChangeStoreToken,
  type SelfChangeImpactPort,
  type AudioTranscriptionPort,
  describeApprovalChannelConflicts,
} from '@zhin.js/agent';
import {
  AgentRuntime,
  agentOperationResourcesToken,
  CapabilityIngress,
  type TurnIntentResolver,
} from '@zhin.js/agent/runtime';
import { AgentTurnIngressRoute } from '@zhin.js/agent/runtime';
import { AgentHostPublicationCoordinator } from '@zhin.js/agent/runtime';

export { AgentRuntime, AgentTurnCoordinator } from '@zhin.js/agent/runtime';

import {
  resolveAgentHostExternalPeers,
  resolveAgentHostMcpServers,
  type AgentHostAIConfig as AIConfig,
} from '@zhin.js/agent/runtime';
import {
  publishAgentToolFeatures,
  type HostAgentTool,
} from '@zhin.js/agent/runtime';
import { AgentRuntimeFoundation } from '@zhin.js/agent/runtime';
import { resolveToolHardGateImApproval } from '@zhin.js/agent/security';
import { ImToolApprovalChannel } from '@zhin.js/agent/runtime';
import { agentToolApprovalQueueToken } from '../console/tool-approvals.js';

const logger = getLogger('agent');
/** #1250: each approval/channel conflict is reported once per process, not on every generation reload. */
const reportedApprovalConflicts = new Set<string>();
const BOOTSTRAP_FILES = ['SOUL.md', 'AGENTS.md', 'TOOLS.md'] as const;
const MAX_BOOTSTRAP_CHARS = 12_000;

export interface InstallAgentHostOptions {
  /** Process-owned trace archive; reuse the generation's existing persistence maintenance. */
  readonly pruneTraces?: () => Promise<unknown>;
  /** Process-owned 群聊插话 / 技能助手 Console status (#970). */
  readonly assistantStatus?: import('../console/assistant-status.js').AssistantStatus;
  /** Process-owned Console surface for self-change approval (ADR 0040 §4). */
  readonly selfChanges?: import('../console/self-changes.js').HostSelfChanges;
  /** Process-owned host side of self-change apply / recover (ADR 0040 §5 / §6). Absent: approved changes wait. */
  readonly selfChangeApply?: import('../self-change-apply.js').HostSelfChangeApply;
  /** Process-owned execution authority attached to exactly one Root. */
  readonly runtime: AgentRuntime;
  /** Process-owned Snapshot reader; local operations hold an exact generation lease. */
  readonly snapshots?: SnapshotReader;
  readonly im: ImRuntime;
  readonly projectRoot: string;
  readonly inference: HostInference;
  /**
   * Resolve the Endpoint Owner id for `/approve` + bashAlways key: the stored chat role `owner`
   * of the account (or its adapter / global, on the same adapter), ADR 0056.
   * Key: adapter instance alias and the account's endpoint id.
   */
  readonly resolveEndpointOwner?: (adapterLocalName: string, endpointKey: string) => string | undefined;
  /** Candidate config Endpoint identities; never read from the old live ImRuntime projection. */
  readonly resolveConfiguredEndpointKeys?: () => Promise<ReadonlySet<string>>;
  /** Extra Host tools (e.g. Speech Host voice_stt / voice_tts). */
  readonly extraTools?: readonly HostAgentTool[];
  /** Optional inbound STT (Speech Host). */
  readonly transcribeUrl?: (audioUrl: string) => Promise<string | null>;
  /** Owner-scoped STT boundary for canonical turn media. */
  readonly audioTranscriber?: AudioTranscriptionPort;
  /** Optional host approval override; IM turns otherwise use createRuntimeApprovalPort. */
  readonly approvalPort?: ApprovalPort;
  /** Trusted product-policy seam for explicit steer/follow-up/observe intent and authorization. */
  readonly resolveTurnIntent?: TurnIntentResolver;
  /** ADR 0040 §2: `InvalidationPlanner` over the committed source ownership, for `change_draft` previews. */
  readonly selfChangeImpact?: SelfChangeImpactPort;
  /**
   * #1051 F1: local plugin roots (relative to the project root) whose convention dirs a self-change may write,
   * re-read from the committed generation on every use. Absent: only the project root's convention dirs.
   */
  readonly selfChangePluginRoots?: () => readonly string[];
}

/**
 * Plugin Runtime Agent Host:
 * - AIService from top-level `ai`
 * - Command miss → `ai:` trigger → **ZhinAgent.process** (inbound queue + session)
 * - CapabilityIngress tools + `ai.mcpServers` + SOUL/AGENTS/TOOLS bootstrap
 * - Collaboration tools (agents / ask / delegate / …) + deferred meta tools
 * - Multi-bot Venues (`ai.venues`) + external peers (`ai.externalPeers`)
 * - Optional inbound STT / `@agent` specialist prompt injection
 * - generation-owned Hook resources / `aiHookRuntimeBus`, TimerScheduler + `schedule_*`
 * - Assistant profile sync + Event Ingress registry (HTTP via Console API)
 * - Main-turn `bash` (sandbox + safety) + Owner `/approve` 命令面
 */
export function installAgentHost(options: InstallAgentHostOptions): RootResourceInstaller {
  const localAssets = new LocalImageAssetStore(join(options.projectRoot, 'data', 'agent-assets'), message => logger.warn(message));
  return async ({ signal, resources, lifecycle, handoff, admission, events, readCandidateSnapshot, config: primaryConfig, addFeature, watchProjectFiles }) => {
    const aiConfig = primaryConfig.get<AIConfig>('ai');
    const assistantConfig = primaryConfig.get<AssistantConfig>('assistant');
    if (!aiConfig || typeof aiConfig !== 'object') return;
    provideAiProviders(resources, builtinAiProviders);
    const mcpEntries = resolveAgentHostMcpServers(aiConfig);
    const externalPeers = resolveAgentHostExternalPeers(aiConfig);
    for (const peer of externalPeers) {
      const releasePeer = getProcessPeerRegistry().declareExternal(peer.platform, peer.userId, peer.label);
      lifecycle.add(releasePeer);
    }
    // #1030 P0: tell the file/bash policy where the project root is and which files only a person may change.
    const hostProtectedPaths = await resolveHostProtectedPaths(options.projectRoot);
    resources.provide(hostProtectedPathsToken, hostProtectedPaths);
    lifecycle.add(await localAssets.acquire());
    resources.provide(localImageAssetsToken, localAssets);
    const agentFoundation = await AgentRuntimeFoundation.create({
      modelRuntime: options.inference.modelRuntimeOptions(),
      acquireDeploymentModels: (input) => options.inference.acquireDeploymentModels(input),
      config: aiConfig,
      localAssets,
      assistantConfig,
      im: options.im,
      projectRoot: options.projectRoot,
      processRuntime: options.runtime,
      approvalPort: options.approvalPort,
      audioTranscriber: options.audioTranscriber,
      resources,
      lifecycle,
    });
    const {
      service,
      agent: zhinAgent,
      knowledgeIndex,
      semanticMemory,
      scheduleTools,
      homeTools,
      assistantEnabled,
    } = agentFoundation;
    const venues = agentFoundation.venues ?? [];
    if (venues.length > 0) {
      const venueRegistry = createVenueRegistry(venues);
      resources.provide(venueRegistryToken, venueRegistry);
      const venueMembershipPort = createVenueMembershipPort({ registry: venueRegistry });
      resources.provide(roomMembershipToken, venueMembershipPort);
      const venueProjector = createVenueProjector({
        registry: venueRegistry,
        send: async (input) => {
          await options.im.endpoints?.send({
            adapter: input.conversation.platform,
            endpointKey: input.endpointId,
            conversation: {
              kind: input.conversation.sceneType ?? 'group',
              id: input.conversation.sceneId,
              ...(input.conversation.threadId ? { threadId: input.conversation.threadId } : {}),
            },
            content: input.text,
          });
        },
      });
      resources.provide(venueProjectorToken, venueProjector);
    }
    resources.provide(pluginDataMigrationProviderToken, createOwnerApprovalMigrationProvider({
      approvals: zhinAgent.ownerApprovals, admission,
    }));
    resources.provide(turnModelPortToken, options.inference.turnPort(service));
    const operationResources = createHostOperationResources({ host: options.inference, quota: zhinAgent.usageQuota });
    resources.provide(imOperationResourcesToken, operationResources.im);
    resources.provide(agentOperationResourcesToken, operationResources.agent);
    // Driver cache state belongs to its declaration, not to account authentication.
    if (readCandidateSnapshot) {
      let definitions: ReturnType<typeof listSnapshotAiProviders> = [];
      // Disposal is registered while the stack is open; activation only captures ownership.
      lifecycle.add(() => options.inference.retireUnusedDrivers(definitions.map(entry => entry.definition)));
      handoff.add({ activateNext() { definitions = listSnapshotAiProviders(readCandidateSnapshot()); } });
    }
    await seedInitialAiPlanIfEmpty(options.projectRoot, options.inference, readCandidateSnapshot, true);
    handoff.add({
      async activateNext(handoffSignal) {
        handoffSignal.throwIfAborted();
        await seedInitialAiPlanIfEmpty(options.projectRoot, options.inference, readCandidateSnapshot, false);
      },
    });
    zhinAgent.hostProtectedPaths = hostProtectedPaths;
    // #1051 F1: the store (drafts), the trial (grouping by plugin root) and the applier (writes) share one view
    // of the local plugin roots, so a draft accepted under `plugins/<x>/commands/` is also trial-run and written.
    const selfChangePluginRoots = options.selfChangePluginRoots ?? (() => []);
    // ADR 0040 §6a: the self-change staging area is bounded — prune on start, then every 6 hours.
    const selfChanges = new SelfChangeStore({
      root: join(options.projectRoot, '.zhin', 'changes'),
      projectRoot: options.projectRoot,
      protectedPaths: hostProtectedPaths,
      pluginRoots: selfChangePluginRoots,
      audit: () => zhinAgent.decisionEvents,
      onError: error => logger.warn(formatCompact({
        op: 'self_change_prune_failed',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    resources.provide(selfChangeStoreToken, selfChanges);
    const selfChangeTrialOptions = createSelfChangeTrialOptions(options.projectRoot);
    lifecycle.add(selfChanges.startPruning());
    resources.provide(agentToolApprovalQueueToken, zhinAgent.toolApprovals);
    events.on('hmr.resume', ({ details }) => {
      if (details.outcome === 'committed' && details.receiver.state === 'replaced') zhinAgent.toolApprovals.dispose();
    });
    lifecycle.add(() => zhinAgent.toolApprovals.dispose());
    // ADR 0040 §5 / §6: approved changes are applied by the process-owned host (reload / gateway restart-request / health),
    // reported through this generation's IM and control plane; the newest generation's applier is the bound one.
    const selfChangeApplyHost = options.selfChangeApply;
    const reportSelfChangeError = (op: string) => (error: unknown) => logger.warn(formatCompact({
      op,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (selfChangeApplyHost) {
      const applier = new SelfChangeApplier({
        store: selfChanges,
        projectRoot: options.projectRoot,
        protectedPaths: hostProtectedPaths,
        pluginRoots: selfChangePluginRoots,
        ports: selfChangeApplyHost.ports(createSelfChangeGenerationPorts({
          send: (target, text) => options.im.endpoints.send({
            adapter: target.adapter,
            endpointKey: target.endpointKey,
            conversation: target.conversation,
            content: text,
          }),
          resolveOwner: options.resolveEndpointOwner,
          control: () => zhinAgent.controlPlane,
          onError: reportSelfChangeError('self_change_report_failed'),
        })),
        onError: reportSelfChangeError('self_change_apply_failed'),
      });
      lifecycle.add(selfChangeApplyHost.bind(applier, async () =>
        (await selfChanges.list()).filter(record => record.status === 'approved').map(record => record.id)));
    }
    // ADR 0040 §4: ready changes go to the same approval queue as hard-gate cards (category `self`, humanOnly).
    const selfChangeApprovals = new SelfChangeApprovals({
      store: selfChanges,
      queue: zhinAgent.toolApprovals,
      onError: reportSelfChangeError('self_change_approval_failed'),
      ...(selfChangeApplyHost
        ? { onApproved: (record: { readonly id: string }) => selfChangeApplyHost.apply(record.id, reportSelfChangeError('self_change_apply_failed')) }
        : {}),
    });
    lifecycle.add(() => selfChangeApprovals.dispose());
    if (options.selfChanges) lifecycle.add(options.selfChanges.bind(selfChanges, selfChangeApprovals));
    // G6 (#1013): IM approval channel for hard-gate cards; idle unless ai.agent.toolHardGate.imApproval.enabled.
    const toolApprovalIm = new ImToolApprovalChannel({
      queue: zhinAgent.toolApprovals,
      settings: () => resolveToolHardGateImApproval(zhinAgent.config.toolHardGate?.imApproval),
      resolveOwner: options.resolveEndpointOwner,
      send: async (target, text) => {
        await options.im.endpoints.send({
          adapter: target.platform,
          endpointKey: target.endpointKey,
          conversation: target.conversation,
          content: text,
        });
      },
      onDeliveryError: (error, target) => {
        logger.warn(formatCompact({
          op: 'tool_approval_im_delivery_failed',
          platform: target.platform,
          kind: target.conversation.kind,
          error: error instanceof Error ? error.message : String(error),
        }));
      },
    });
    lifecycle.add(toolApprovalIm.start());
    // The queue lives in memory: re-issue cards for changes still pending on disk (and re-deliver them).
    void selfChangeApprovals.restore().catch(error => logger.warn(formatCompact({
      op: 'self_change_restore_failed',
      error: error instanceof Error ? error.message : String(error),
    })));
    const ingress = new CapabilityIngress();
    let bootstrap = await loadBootstrap(options.projectRoot);
    const { bootstrapText, contextFiles } = bootstrap;
    // #1250: an edited SOUL / AGENTS / TOOLS file is re-read in place; it no longer rebuilds the
    // Root generation (and with it every adapter Endpoint). Turns read the current bootstrap.
    watchProjectFiles?.({
      patterns: BOOTSTRAP_FILES,
      async onChange({ files }) {
        bootstrap = await loadBootstrap(options.projectRoot);
        logger.info(formatCompact({
          op: 'agent_bootstrap_reloaded',
          files: files.map((file) => relative(options.projectRoot, file).split('\\').join('/')).join(','),
          chars: bootstrap.bootstrapText.length,
        }));
      },
    });
    const knowledgeRoot = knowledgeIndex ? relative(options.projectRoot, knowledgeIndex.root).split('\\').join('/') : undefined;
    if (knowledgeIndex && knowledgeRoot && !knowledgeRoot.startsWith('..') && !isAbsolute(knowledgeRoot)) {
      // The knowledge index reads its directory on search; a change only drops its cache.
      watchProjectFiles?.({ patterns: [`${knowledgeRoot}/**`], onChange: () => knowledgeIndex.invalidate() });
    }

    // Register before any await so a cancelled generation cannot leak Agent
    // Resources. DisposeStack continues through later cleanup when one
    // Resource fails.
    publishAgentToolFeatures({
      addFeature,
      projectRoot: options.projectRoot,
      service,
      mcpServers: mcpEntries,
      localAssets,
      hostTools: options.extraTools,
      runtimeTools: [...scheduleTools, ...homeTools],
      knowledgeIndex,
      semanticMemory: semanticMemory ?? undefined,
      announcements: () => zhinAgent.getAnnouncements?.(),
      sessionEvents: () => zhinAgent.getSessionEvents?.(),
      groupRules: () => zhinAgent.getGroupRules?.(),
      selfChanges: {
        store: () => selfChanges,
        impact: () => options.selfChangeImpact,
        trial: () => ({ ...selfChangeTrialOptions, pluginRoots: selfChangePluginRoots() }),
        approvals: () => selfChangeApprovals,
        // #1051 F4: master + IM approvers (same allowlist as G6 cards) may draft.
        imApproval: () => resolveToolHardGateImApproval(zhinAgent.config.toolHardGate?.imApproval),
        ...(selfChangeApplyHost ? { restartSupported: () => selfChangeApplyHost.restartSupported } : {}),
      },
    });

    new AgentHostPublicationCoordinator({
      projectRoot: options.projectRoot,
      signal,
      resources,
      processRuntime: options.runtime,
      agent: agentFoundation,
      bootstrapText,
      contextFiles,
      bootstrap: () => ({ bootstrapContext: bootstrap.bootstrapText, contextFiles: bootstrap.contextFiles }),
    });

    installAgentPersistence({ resources, handoff, lifecycle, admission }, agentFoundation, aiConfig, options.pruneTraces);
    const binding = service.getBindingRegistry().requireZhinBinding();

    const ingressRoute = new AgentTurnIngressRoute({
      projectRoot: options.projectRoot,
      runtime: options.runtime,
      im: options.im,
      transcribeUrl: options.transcribeUrl,
      approvalPort: options.approvalPort,
      resolveTurnIntent: options.resolveTurnIntent,
      resolveEndpointOwner: options.resolveEndpointOwner,
      ingress,
      agent: agentFoundation,
      ...(options.assistantStatus ? { assistantStatus: options.assistantStatus } : {}),
      toolApprovalIm,
      withInferenceScope: (input, operation) => options.inference.withInferenceScope(input, operation),
      withModelScope: (input, operation) => options.inference.withDeploymentModels({ ...input, service }, operation),
    });
    resources.provide(ingressRouteToken, ingressRoute);
    // #1012 A9 方案②：插件旧欢迎（group-suite）发送前询问；会话开启 welcome.enabled 时让给 MemberLifecycle。
    const memberWelcomeOwner: MemberWelcomeOwner = Object.freeze({
      ownsWelcome: (conversation: ConversationRef) => ingressRoute.ownsMemberWelcome(conversation),
    });
    resources.provide(memberWelcomeOwnerToken, memberWelcomeOwner);
    // ADR 0039 §5：插件（content-moderation）判定违规后交给群规执行器；迁移时按默认模板生成待确认规则。
    const groupRuleViolations = Object.freeze<GroupRuleViolationSink>({
      report: (violation) => ingressRoute.reportGroupRuleViolation(violation),
      ensureDefaultRule: (input) => ingressRoute.ensureDefaultGroupRule(input),
    });
    resources.provide(groupRuleViolationToken, groupRuleViolations);
    // 状态感知（#996）：社交事件落库即交给本 generation 的 ingress route；generation 结束时退订并清掉待唤醒批次。
    const unsubscribeSceneEvents = options.im.sceneEvents?.subscribe((event) => ingressRoute.handleSceneEvent(event));
    const stopSceneEvents = () => {
      unsubscribeSceneEvents?.();
      ingressRoute.dispose();
    };
    if (signal.aborted) stopSceneEvents();
    else signal.addEventListener('abort', stopSceneEvents, { once: true });

    const features = [
      options.transcribeUrl ? 'inboundStt' : '',
      scheduleTools.length > 0 ? 'schedule' : '',
      homeTools.length > 0 ? 'home' : '',
      assistantEnabled ? 'assistant' : '',
      venues.length > 0 ? `venues:${venues.length}` : '',
      'bash',
      options.resolveEndpointOwner ? 'approve' : '',
    ].filter(Boolean).join(',');
    for (const conflict of describeApprovalChannelConflicts({
      execApprovalMode: zhinAgent.config.execApprovalMode,
      confirmHighRisk: zhinAgent.config.injectionGuard?.confirmHighRisk,
      unattendedChannels: [
        ...(scheduleTools.length > 0 ? ['定时任务'] : []),
        ...(assistantEnabled ? ['助理提醒'] : []),
      ],
    })) {
      if (reportedApprovalConflicts.has(conflict)) continue;
      reportedApprovalConflicts.add(conflict);
      logger.warn(formatCompact({ op: 'approval_channel_conflict', detail: conflict }));
    }
    logger.info(
      `ready | ${binding.name}`
      + ` | mcp: ${mcpEntries.map((entry) => entry.name).join(',') || '-'}`
      + ` | ${features}`,
    );
    logger.debug(
      `ready detail | runtime model selection`
      + ` | mcp: ${mcpEntries.map((entry) => entry.name).join(',') || '-'}`
      + ` | tools: ${(options.extraTools ?? []).map((tool) => tool.name).join(',') || '-'}`,
    );
  };
}


async function loadBootstrap(projectRoot: string): Promise<{
  bootstrapText: string;
  contextFiles: readonly ContextFile[];
}> {
  const parts: string[] = [];
  const contextFiles: ContextFile[] = [];
  let total = 0;
  for (const name of BOOTSTRAP_FILES) {
    try {
      const raw = await readFile(join(projectRoot, name), 'utf8');
      const body = raw.trim();
      if (!body) continue;
      const chunk = truncate(body, Math.max(500, MAX_BOOTSTRAP_CHARS - total));
      parts.push(`## ${name}\n${chunk}`);
      contextFiles.push({ path: name, content: chunk });
      total += chunk.length;
      if (total >= MAX_BOOTSTRAP_CHARS) break;
    } catch {
      /* missing bootstrap files are optional */
    }
  }
  return { bootstrapText: parts.join('\n\n'), contextFiles };
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

async function seedInitialAiPlanIfEmpty(
  projectRoot: string,
  inference: HostInference,
  readCandidateSnapshot?: () => ReturnType<SnapshotReader['acquire']>['value'],
  allowDeferredDatabase = false,
): Promise<void> {
  const planPath = join(projectRoot, 'ai.plan.yml');
  let rawPlan: string;
  try {
    rawPlan = await readFile(planPath, 'utf8');
  } catch {
    return;
  }
  try {
    const existing = await inference.repository.readGraph({ rootId: inference.rootId });
    if (
      existing &&
      (existing.revision > 0 ||
        Object.keys(existing.services).length > 0 ||
        Object.keys(existing.accounts).length > 0 ||
        Object.keys(existing.profiles).length > 0)
    ) {
      return;
    }
    const proposal = yaml.parse(rawPlan);
    if (!proposal || typeof proposal !== 'object') return;
    const snapshot = readCandidateSnapshot?.();
    const resolveDriverEntry = (id: string, owner?: string) => {
      if (snapshot) {
        return describeSnapshotAiProvider({
          snapshot,
          id,
          ...(owner ? { owner: owner as PluginId } : {}),
        });
      }
      const def = builtinAiProviders.find((d) => d.id === id);
      if (!def) throw new ProviderError('driver-unavailable');
      return { owner: (owner as PluginId | undefined) ?? rootPluginId(), definition: def };
    };
    const emptyGraph: ProviderGraph = {
      rootId: inference.rootId,
      revision: 0,
      services: {},
      accounts: {},
      profiles: {},
      purposes: { defaults: {} },
    };
    const reviewed = await reviewProviderPlan({
      input: proposal,
      graph: emptyGraph,
      ownerId: inference.hostOwnerId,
      hostOwnerId: inference.hostOwnerId,
      createId: (kind) => `${kind}:${randomUUID()}`,
      resolveService: (input) => {
        const reference =
          typeof input.driver === 'string'
            ? {
                id: input.driver,
                ...(input.existing ? { owner: input.existing.driver.owner } : {}),
              }
            : input.driver;
        const entry = resolveDriverEntry(reference.id, reference.owner);
        if (
          'contractVersion' in reference &&
          reference.contractVersion !== entry.definition.contractVersion
        ) {
          throw new ProviderError('driver-contract-mismatch');
        }
        const options = entry.definition.serviceSchema.parse(input.options);
        const enrichedModels = Object.fromEntries(
          Object.entries(input.models).map(([id, model]) => [
            id,
            applyModelCapabilityDefaults(model),
          ]),
        );
        const service: ProviderService<unknown> = {
          id: input.existing?.id ?? `preview:${randomUUID()}`,
          rootId: inference.rootId,
          ownerId: input.existing?.ownerId ?? inference.hostOwnerId,
          revision: input.existing?.revision ?? 1,
          driver: {
            id: entry.definition.id,
            owner: entry.owner,
            contractVersion: entry.definition.contractVersion,
          },
          options,
          models: enrichedModels,
        };
        return {
          driver: service.driver,
          options: options as ProviderService['options'],
          models: entry.definition.models(service),
          ...(entry.definition.identity
            ? {
                identity: (candidate: ProviderService) =>
                  entry.definition.identity!({
                    ...candidate,
                    options: entry.definition.serviceSchema.parse(candidate.options),
                  }),
              }
            : {}),
        };
      },
    });
    const result = await inference.repository.commit({
      rootId: inference.rootId,
      mutationId: `seed-ai-plan:${randomUUID()}`,
      fingerprint: providerPlanFingerprint(reviewed.graph),
      expectedRevision: 0,
      graph: reviewed.graph,
      credentials: [],
      result: {
        ownerId: inference.hostOwnerId,
        bindings: reviewed.bindings as unknown as JsonObject,
      },
    });
    if (result.status === 'committed') {
      await inference.accounts?.committed({
        graph: reviewed.graph,
        removedAccounts: [],
        credentials: [],
      });
      logger.info(
        `Seeded initial AI inference graph from ai.plan.yml (revision ${reviewed.graph.revision})`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      allowDeferredDatabase &&
      (message.includes('DatabaseHost is not started') ||
        message.includes('Inference storage: unavailable') ||
        (error instanceof Error && 'code' in error && error.code === 'unavailable'))
    ) {
      return;
    }
    logger.warn(`ai.plan.yml auto-seed failed: ${message}`);
  }
}
