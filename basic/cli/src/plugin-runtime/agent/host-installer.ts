import { installAgentPersistence } from './persistence-coordinator.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  ingressRouteToken,
  type ImRuntime,
} from '@zhin.js/core/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { type DisposeStack, type SnapshotReader } from '@zhin.js/plugin-runtime';
import {
  type AssistantConfig,
  type ApprovalPort,
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

const logger = getLogger('agent');
const BOOTSTRAP_FILES = ['SOUL.md', 'AGENTS.md', 'TOOLS.md'] as const;
const MAX_BOOTSTRAP_CHARS = 12_000;

export interface InstallAgentHostOptions {
  /** Process-owned 群聊插话 / 技能助手 Console status (#970). */
  readonly assistantStatus?: import('../console/assistant-status.js').AssistantStatus;
  /** Process-owned Console approval cards for the dangerous-tool hard gate (ADR 0036). */
  readonly toolApprovals?: import('../console/tool-approvals.js').HostToolApprovals;
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
  return async ({ generation, signal, resources, lifecycle, handoff, admission, readCandidateSnapshot, config: primaryConfig, addFeature }) => {
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
    const agentFoundation = await AgentRuntimeFoundation.create({
      config: aiConfig,
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
    if (options.toolApprovals) lifecycle.add(options.toolApprovals.bind(zhinAgent.toolApprovals));
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
      hostTools: options.extraTools,
      runtimeTools: [...scheduleTools, ...homeTools],
      knowledgeIndex,
      semanticMemory: semanticMemory ?? undefined,
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
    installAgentPersistence({ resources, handoff, lifecycle, admission }, agentFoundation, aiConfig);
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
    });
    resources.provide(ingressRouteToken, ingressRoute);
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
