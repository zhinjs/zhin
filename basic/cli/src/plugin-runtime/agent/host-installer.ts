import { RuntimePolicyManagementService } from '../runtime-model-policy/service.js';
import { runtimePolicyManagementToken } from '../runtime-model-policy/token.js';
import { createPersonalSessionDirectory } from '../personal-models/directory.js';
import { PersonalModelManagementService } from '../personal-models/service.js';
import { personalModelManagementToken } from '../personal-models/token.js';
import { createPersonalModelHost } from '../personal-models/host.js';
import { turnModelPortToken } from '@zhin.js/agent/model-runtime';
import { createOwnerApprovalMigrationProvider } from '../data-migration/owner-approval-provider.js';
import { pluginDataMigrationProviderToken, databaseRootHostToken, type DisposeStack, type SnapshotReader } from '@zhin.js/plugin-runtime';
import { resolveHostProtectedPaths } from './host-protected-paths.js';
import { installAgentPersistence } from './persistence-coordinator.js';
import { createSelfChangeTrialOptions } from './self-change-trial.js';
import { createSelfChangeGenerationPorts } from './self-change-report.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  groupRuleViolationToken,
  ingressRouteToken,
  memberWelcomeOwnerToken,
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
  type ApprovalPort,
  hostProtectedPathsToken,
  SelfChangeApplier,
  SelfChangeApprovals,
  SelfChangeStore,
  selfChangeStoreToken,
  type SelfChangeImpactPort,
  type AudioTranscriptionPort,
} from '@zhin.js/agent';
import type {
  HumanIngressOrchestratorProposalPort,
  WorkroomPlanGateAuthorityPort,
  WorkroomDynamicPlanningPolicyPort,
  WorkroomPlanningDisclosurePort,
  SelfDeliveryHostConfiguration,
} from '@zhin.js/workroom';
import {
  AgentRuntime,
  CapabilityIngress,
  agentDecisionConfigToken,
  normalizeAgentDecisionConfig,
  resolveAgentDecisionRuntime,
  type TurnIntentResolver,
} from '@zhin.js/agent/runtime';
import { AgentTurnIngressRoute } from './turn/ingress-route.js';
import { AgentHostPublicationCoordinator } from './publication-coordinator.js';
import type { LocalWorkroomDataGovernanceAuthority } from '../workroom/module.js';
import type { WorkroomHostModule } from './workroom-loader.js';

export { AgentRuntime, AgentTurnCoordinator } from '@zhin.js/agent/runtime';

import {
  createRuntimeApprovalPort,
} from './turn/request.js';
import {
  resolveAgentHostMcpServers,
  type AgentHostAIConfig as AIConfig,
  type WorkroomStorageMode,
} from './config.js';
import {
  publishAgentToolFeatures,
  type HostAgentTool,
} from './tool-feature-publisher.js';
import { AgentRuntimeFoundation } from './runtime-foundation.js';
import { resolveToolHardGateImApproval } from '@zhin.js/agent/security';
import { ImToolApprovalChannel } from './tool-approval-im-channel.js';
import { agentToolApprovalQueueToken } from '../console/tool-approval-resource.js';

const logger = getLogger('agent');
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
  /** Root-private self-delivery authentication/integration configuration. Never accepts model-supplied policy. */
  readonly selfDelivery?: SelfDeliveryHostConfiguration;
  /**
   * Optional Workroom Host module, loaded once by the caller. Absent when
   * `@zhin.js/workroom` is not installed; the Agent then runs without Workroom.
   */
  readonly workroom?: WorkroomHostModule;
  /** Process-owned execution authority attached to exactly one Root. */
  readonly runtime: AgentRuntime;
  /** Process-owned Snapshot reader; local Assignment operations hold an exact generation lease. */
  readonly snapshots?: SnapshotReader;
  /** Process-fixed Workroom storage identity. Changing it requires restart. */
  readonly workroomStorageMode: WorkroomStorageMode;
  readonly im: ImRuntime;
  readonly projectRoot: string;
  readonly resolveModelSecret?: (reference: string) => string | undefined | Promise<string | undefined>;
  /**
   * Resolve Endpoint Owner id for `/approve` + bashAlways key.
   * Key: `localName` (e.g. icqq) or live endpoint name (uin).
   */
  readonly resolveEndpointOwner?: (adapterLocalName: string, endpointKey: string) => string | undefined;
  /**
   * Resolve Endpoint trusted id 列表（plugins.<key>.trusted / endpoints[].trusted）。
   * trusted 角色弱于 master，不参与 Owner 审批放行。
   */
  readonly resolveEndpointTrusted?: (adapterLocalName: string, endpointKey: string) => readonly string[];
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
  /** Trusted idempotent Orchestrator/Kernel proposal seam for Workroom human ingress. */
  readonly workroomHumanIngressPort?: HumanIngressOrchestratorProposalPort;
  /** P12 governed model-provider disclosure; absence fails closed before model invocation. */
  readonly workroomPlanningDisclosurePort?: WorkroomPlanningDisclosurePort;
  /** Persistent exact Project/Profile planning policy; absence fails closed. */
  readonly workroomDynamicPlanningPolicyPort?: WorkroomDynamicPlanningPolicyPort;
  /** Authenticated Sponsor authority for typed pre-execution Plan Gate decisions. */
  readonly workroomPlanGateAuthority?: WorkroomPlanGateAuthorityPort;
  /** Process-owned shared Pack publisher membership; never accepted from HTTP request bodies. */
  readonly workroomTrustedPackPublishers?: readonly string[];
  /** Self-hosted Root-private KMS and signed governance decision issuer. */
  readonly workroomLocalDataGovernance?: LocalWorkroomDataGovernanceAuthority;
  /** ADR 0040 §2: `InvalidationPlanner` over the committed source ownership, for `change_draft` previews. */
  readonly selfChangeImpact?: SelfChangeImpactPort;
}

/**
 * Plugin Runtime Agent Host:
 * - AIService from top-level `ai`
 * - Command miss → `ai:` trigger → **ZhinAgent.process** (inbound queue + session)
 * - CapabilityIngress tools + `ai.mcpServers` + SOUL/AGENTS/TOOLS bootstrap
 * - SubagentSystem + `spawn_task` (parallel sub-agents) + deferred meta tools
 * - Optional inbound STT / `@agent` specialist prompt injection
 * - generation-owned Hook resources / `aiHookRuntimeBus`, ScheduleJobEngine + `schedule_*`
 * - Assistant profile sync + Event Ingress registry (HTTP via Console API)
 * - Subagent/main-turn `bash` (sandbox + safety) + Owner `/approve` 命令面
 */
export function installAgentHost(options: InstallAgentHostOptions): RootResourceInstaller {
  const localAssets = new LocalImageAssetStore(join(options.projectRoot, 'data', 'agent-assets'), message => logger.warn(message));
  return async ({ generation, signal, resources, lifecycle, handoff, admission, events, readCandidateSnapshot, config: primaryConfig, addFeature }) => {
    const aiConfig = primaryConfig.get<AIConfig>('ai');
    const assistantConfig = primaryConfig.get<AssistantConfig>('assistant');
    if (!aiConfig || typeof aiConfig !== 'object') return;
    const decisions = normalizeAgentDecisionConfig(aiConfig.decisions);
    if (decisions) {
      resources.provide(agentDecisionConfigToken, decisions);
      handoff.add({
        activateNext(activationSignal) {
          activationSignal.throwIfAborted();
          if (!readCandidateSnapshot) throw new Error('DecisionProvider validation requires the candidate generation snapshot');
          resolveAgentDecisionRuntime(readCandidateSnapshot());
        },
      });
    }
    const mcpEntries = resolveAgentHostMcpServers(aiConfig);
    // #1030 P0: tell the file/bash policy where the project root is and which files only a person may change.
    const hostProtectedPaths = await resolveHostProtectedPaths(options.projectRoot);
    resources.provide(hostProtectedPathsToken, hostProtectedPaths);
    lifecycle.add(await localAssets.acquire());
    resources.provide(localImageAssetsToken, localAssets);
    const personalModels = createPersonalModelHost({
      projectRoot: options.projectRoot,
      state: () => resources.has(databaseRootHostToken) ? resources.use(databaseRootHostToken).state : undefined,
      resolveHostSecret: reference => options.resolveModelSecret?.(reference),
    });
    const agentFoundation = await AgentRuntimeFoundation.create({
      modelRuntime: personalModels.runtimeOptions,
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
    resources.provide(pluginDataMigrationProviderToken, createOwnerApprovalMigrationProvider({
      approvals: zhinAgent.ownerApprovals, admission,
    }));
    resources.provide(turnModelPortToken, personalModels.turnPort(service));
    resources.provide(runtimePolicyManagementToken, new RuntimePolicyManagementService({
      rootId: personalModels.rootId, repository: personalModels.runtimePolicy, runtime: () => service.getModelRuntime(),
    }));
    resources.provide(personalModelManagementToken, new PersonalModelManagementService({
      rootId: personalModels.rootId,
      hostOwnerId: personalModels.hostOwnerId,
      bindings: aiConfig.personalPrincipals ?? {},
      state: personalModels.state,
      directory: createPersonalSessionDirectory(() => resources.has(databaseRootHostToken) ? resources.use(databaseRootHostToken) : undefined),
      vault: personalModels.vault,
      hostCatalog: () => service.getModelRuntime().getCatalogConfig(),
    }));
    zhinAgent.hostProtectedPaths = hostProtectedPaths;
    // ADR 0040 §6a: the self-change staging area is bounded — prune on start, then every 6 hours.
    const selfChanges = new SelfChangeStore({
      root: join(options.projectRoot, '.zhin', 'changes'),
      projectRoot: options.projectRoot,
      protectedPaths: hostProtectedPaths,
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
    // ADR 0040 §5 / §6: approved changes are applied by the process-owned host (reload / exit 75 / health),
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
    const assembly = options.workroom?.WorkroomHostAssembly.begin({
      generation,
      signal,
      resources,
      planGateAuthority: options.workroomPlanGateAuthority,
      planningDisclosure: options.workroomPlanningDisclosurePort,
      dynamicPlanningPolicy: options.workroomDynamicPlanningPolicyPort,
    });
    const bootstrapText = await loadBootstrap(options.projectRoot);

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
      selfChanges: { store: () => selfChanges, impact: () => options.selfChangeImpact, trial: () => selfChangeTrialOptions, approvals: () => selfChangeApprovals },
    });

    const publicationCoordinator = new AgentHostPublicationCoordinator({
      projectRoot: options.projectRoot,
      signal,
      resources,
      processRuntime: options.runtime,
      agent: agentFoundation,
      bootstrapText,
    });

    const workroom = assembly
      ? await assembly.compose({
        projectRoot: options.projectRoot,
        lifecycle,
        handoff,
        snapshots: options.snapshots,
        config: aiConfig,
        storageMode: options.workroomStorageMode,
        im: options.im,
        selfDelivery: options.selfDelivery,
        agent: agentFoundation,
        ingress,
        resolveConfiguredEndpointKeys: options.resolveConfiguredEndpointKeys,
        humanIngressPort: options.workroomHumanIngressPort,
        trustedPackPublishers: options.workroomTrustedPackPublishers,
        localDataGovernance: options.workroomLocalDataGovernance,
      })
      : undefined;
    const presetCount = workroom ? workroom.presetCount : await agentFoundation.seedPresets();
    // Workroom validates its authority first; the candidate Agent remains unadmitted until all handoffs finish.
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
      resolveEndpointTrusted: options.resolveEndpointTrusted,
      ingress,
      agent: agentFoundation,
      ...(workroom ? { workroom } : {}),
      ...(options.assistantStatus ? { assistantStatus: options.assistantStatus } : {}),
      toolApprovalIm,
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

    const providers = service.listProviders();
    const features = [
      zhinAgent.getSubagentSystem() ? 'subagent' : '',
      options.transcribeUrl ? 'inboundStt' : '',
      scheduleTools.length > 0 ? 'schedule' : '',
      homeTools.length > 0 ? 'home' : '',
      assistantEnabled ? 'assistant' : '',
      'bash',
      options.resolveEndpointOwner ? 'approve' : '',
    ].filter(Boolean).join(',');
    logger.info(
      `ready | ${binding.name}@${binding.providerAlias}/${binding.model}`
      + ` | providers: ${providers.length}`
      + ` | presets: ${presetCount}`
      + ` | mcp: ${mcpEntries.map((entry) => entry.name).join(',') || '-'}`
      + ` | ${features}`
      + ` | persistence: ${workroom ? (workroom.persistence.pendingActivation ? 'pending_activate' : 'file') : '-'}`,
    );
    logger.debug(
      `ready detail | providers: ${providers.join(',')}`
      + ` | mcp: ${mcpEntries.map((entry) => entry.name).join(',') || '-'}`
      + ` | tools: ${(options.extraTools ?? []).map((tool) => tool.name).join(',') || '-'}`,
    );
  };
}


async function loadBootstrap(projectRoot: string): Promise<string> {
  const parts: string[] = [];
  let total = 0;
  for (const name of BOOTSTRAP_FILES) {
    try {
      const raw = await readFile(join(projectRoot, name), 'utf8');
      const body = raw.trim();
      if (!body) continue;
      const chunk = truncate(body, Math.max(500, MAX_BOOTSTRAP_CHARS - total));
      parts.push(`## ${name}\n${chunk}`);
      total += chunk.length;
      if (total >= MAX_BOOTSTRAP_CHARS) break;
    } catch {
      /* missing bootstrap files are optional */
    }
  }
  return parts.join('\n\n');
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
