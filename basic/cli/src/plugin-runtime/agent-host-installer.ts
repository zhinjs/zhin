import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  createSyntheticMessage,
  resolveSceneFieldsFromMessage,
  collectSegmentMedia,
  toCanonicalSegments,
  type AITriggerConfig,
  type Tool,
} from '@zhin.js/core';
import { ingressRouteToken, type ImRuntime, type Message, type SendContent } from '@zhin.js/core/runtime';
import {
  expandEnvironmentValue,
  type ConfigDocumentPort,
  type RootResourceInstaller,
  type RuntimeConfigDocument,
} from '@zhin.js/runtime';
import { databaseRootHostToken, type DisposeStack, type PluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  AIService,
  ZhinAgent,
  composeZhinAgentRuntime,
  AgentOrchestrator,
  discoverWorkspaceAgents,
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createListDirTool,
  createGlobTool,
  createGrepTool,
  createWebSearchTool,
  createWebFetchTool,
  createBashTool,
  activateAiDatabaseStorage,
  defineAiDatabaseModels,
  createScheduleJobStoreFromConfig,
  createScheduleTools,
  ScheduleJobEngine,
  JobWorker,
  createTaskExecutor,
  createNotificationRouter,
  resolveAssistantConfig,
  resolveAssistantDefaultsConfig,
  parseJobNotify,
  provideAssistantRuntime,
  AssistantEventIngress,
  loadAssistantProfileFile,
  validateAssistantProfile,
  syncProfileHeartbeatToStore,
  syncProfileRoutinesToStore,
  pruneStaleProfileCronJobs,
  bootstrapAssistantHome,
  OrchestrationService,
  provideOrchestrationService,
  MemoryOrchestrationRepository,
  registerDefaultExecutors,
  provideOrchestrationRuntime,
  createOrchestrationRuntimeFromService,
  provideSessionTreeRuntime,
  createSessionTreeRuntimeFromAgent,
  asPrivate,
  wireCollaborationStorage,
  applyRuntimeCollaborationInbound,
  findCellForInbound,
  getCollaborationSceneService,
  handleRuntimeOwnerApproveCommand,
  handleRuntimeManagementCommand,
  publishOutboundElements,
  type ProactiveOutboundService,
  type AssistantConfig,
  type AssistantRuntimeHandle,
  type BootstrapAssistantHomeResult,
  type OrchestrationRuntimeHandle,
  type SessionTreeRuntimeHandle,
  type ImTranscriptWriteInput,
  type PeerTriggerMode,
  type ApprovalPort,
  type TurnRequestPorts,
  type TurnRequest,
  type TurnOutcome,
  type TurnAccessContext,
  FileJournalStore,
} from '@zhin.js/agent';
import { resolveAgentTurnSessionKey } from '@zhin.js/agent/session';
import {
  agentHostToken,
  CapabilityIngress,
  projectHostTool,
  projectHostMcp,
  toolFeatureId,
  turnJournalStoreToken,
  agentTurnEngineToken,
  createFullAgentTurnEngine,
  createNativeFileToolFeatures,
  AgentRuntime,
  type AgentCapabilities,
  type ToolCapability,
} from '@zhin.js/agent/runtime';

export { AgentRuntime, AgentTurnCoordinator } from '@zhin.js/agent/runtime';

/** Minimal OutputElement shape for reply flattening (avoid direct @zhin.js/ai dep). */
type OutputElementLike = {
  readonly type: string;
  readonly content?: string;
  readonly url?: string;
  readonly title?: string;
  readonly name?: string;
  readonly description?: string;
  readonly fallbackText?: string;
};

type AIConfig = NonNullable<ConstructorParameters<typeof AIService>[0]>;
type McpServerConfig = NonNullable<AIConfig['mcpServers']>[number];

interface AgentToolLike {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
  execute(args: Record<string, unknown>): Promise<unknown>;
  readonly source?: string;
  readonly platforms?: readonly string[];
  readonly scopes?: readonly ('private' | 'group' | 'channel')[];
  readonly permissions?: readonly string[];
  readonly hidden?: boolean;
  readonly approval?: 'always' | 'once' | 'never' | 'on-risk';
}

interface McpServerEntry {
  readonly name: string;
  readonly transport: 'stdio' | 'streamable-http' | 'sse';
  readonly url?: string;
  readonly command?: string;
  readonly args?: string[];
  readonly env?: Record<string, string>;
  readonly headers?: Record<string, string>;
}

const logger = getLogger('agent');
const BOOTSTRAP_FILES = ['SOUL.md', 'AGENTS.md', 'TOOLS.md'] as const;
const MAX_BOOTSTRAP_CHARS = 12_000;

export async function resolveAiConfig(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<AIConfig | undefined> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return undefined;
  const ai = (document as Record<string, unknown>).ai;
  if (!ai || typeof ai !== 'object') return undefined;
  // Top-level `ai` bypasses Plugin ConfigView, so expand environment values
  // here. Validation remains fail-closed; missing secrets are errors.
  return expandEnvironmentValue(ai, (key) => process.env[key]) as AIConfig;
}

export async function resolveAssistantConfigDocument(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<AssistantConfig | undefined> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return undefined;
  const assistant = (document as Record<string, unknown>).assistant;
  if (!assistant || typeof assistant !== 'object') return undefined;
  return expandEnvironmentValue(assistant, (key) => process.env[key]) as AssistantConfig;
}

export async function resolveCollaborationConfigDocument(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<unknown | undefined> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return undefined;
  return (document as Record<string, unknown>).collaboration;
}

export interface InstallAgentHostOptions {
  /** Process-owned execution authority attached to exactly one Root. */
  readonly runtime: AgentRuntime;
  /** @deprecated Prefer the generation-owned Primary Config. Test overrides only. */
  readonly ai?: AIConfig;
  /** @deprecated Prefer the generation-owned Primary Config. Test overrides only. */
  readonly assistant?: AssistantConfig;
  /** @deprecated Prefer the generation-owned Primary Config. Test overrides only. */
  readonly collaboration?: unknown;
  readonly im: ImRuntime;
  readonly projectRoot: string;
  /**
   * Resolve Endpoint Owner id for `/approve` + bashAlways key.
   * Key: `localName` (e.g. icqq) or live endpoint name (uin).
   */
  readonly resolveEndpointOwner?: (adapterLocalName: string, endpointKey: string) => string | undefined;
  /**
   * Resolve Endpoint trusted id 列表（plugins.<key>.trusted / endpoints[].trusted）。
   * 对齐 legacy resolveSenderRoles：trusted 角色弱于 master（不参与 Owner 审批放行）。
   */
  readonly resolveEndpointTrusted?: (adapterLocalName: string, endpointKey: string) => readonly string[];
  /** Extra Host tools (e.g. Speech Host voice_stt / voice_tts). */
  readonly extraTools?: readonly AgentToolLike[];
  /** Optional inbound STT (Speech Host). */
  readonly transcribeUrl?: (audioUrl: string) => Promise<string | null>;
  /** Optional host approval channel; absent channels fail closed for on-risk tools. */
  readonly approvalPort?: ApprovalPort;
}

/**
 * Plugin Runtime Agent Host:
 * - AIService from top-level `ai`
 * - Command miss → `ai:` trigger → **ZhinAgent.process** (inbound queue + session)
 * - CapabilityIngress tools + `ai.mcpServers` + SOUL/AGENTS/TOOLS bootstrap
 * - SubagentSystem + `spawn_task` (parallel sub-agents) + deferred meta tools
 * - Optional inbound STT / `@agent` specialist prompt injection
 * - `registerAIHook` / `aiHookRuntimeBus`, ScheduleJobEngine + `schedule_*`
 * - Assistant profile sync + Event Ingress registry (HTTP via Console API)
 * - Collaboration storage + Runtime peer/at/handback/dispatch gate
 * - Subagent/main-turn `bash` (sandbox + safety) + Owner `/approve` 命令面
 */
export function installAgentHost(options: InstallAgentHostOptions): RootResourceInstaller {
  return async ({ resources, lifecycle, handoff, config: primaryConfig, addFeature }) => {
    const configuredAi = options.ai ?? primaryConfig.get<AIConfig>('ai');
    const aiConfig = configuredAi;
    const assistantConfig = options.assistant
      ?? primaryConfig.get<AssistantConfig>('assistant');
    const collaborationConfig = options.collaboration
      ?? primaryConfig.get('collaboration');
    if (!aiConfig || typeof aiConfig !== 'object') return;
    const mcpEntries = parseMcpServers(aiConfig.mcpServers);

    let service: AIService;
    try {
      service = new AIService(aiConfig);
    } catch (error) {
      throw new Error('Agent Host rejected invalid AI configuration', { cause: error });
    }
    if (!service.isReady()) {
      service.dispose();
      throw new Error('Agent Host requires at least one ready AI provider');
    }
    if (!service.getBindingRegistry().getBinding('zhin')) {
      service.dispose();
      throw new Error('Agent Host requires a ready ai.agents.zhin binding');
    }
    lifecycle.add(() => service.dispose());

    let zhinAgent: ZhinAgent | undefined;
    let composedRuntime: ReturnType<typeof composeZhinAgentRuntime> | undefined;
    let seedPresets: () => Promise<number>;
    let scheduleTools: ReturnType<typeof createScheduleTools> = [];
    let homeTools: BootstrapAssistantHomeResult['tools'] = [];
    let assistantEnabled = false;
    let collaborationReady = false;
    let orchService: OrchestrationService;
    let orchestrationRuntime: OrchestrationRuntimeHandle;
    let sessionTreeRuntime: SessionTreeRuntimeHandle;
    let schedule: ReturnType<typeof wireRuntimeSchedule>;
    try {
      const created = createRuntimeZhinAgent(
        service,
        options.im,
        options.projectRoot,
        options.approvalPort,
      );
      zhinAgent = created.agent;
      composedRuntime = created.runtime;
      lifecycle.add(() => created.agent.dispose());
      seedPresets = created.seedPresets;

      orchService = new OrchestrationService(new MemoryOrchestrationRepository());
      provideOrchestrationService({ lifecycle }, orchService);
      registerDefaultExecutors(orchService, {
        refs: { zhinAgent, aiService: service },
      });
      // Console REST（/api/agent/orchestration/*、session tree）读取这两个
      // generation-scoped 服务端口；此前 Runtime 路径漏接会令两个页面返回 503。
      orchestrationRuntime = createOrchestrationRuntimeFromService(orchService);
      sessionTreeRuntime = createSessionTreeRuntimeFromAgent(asPrivate(zhinAgent));
      provideOrchestrationRuntime({ lifecycle }, orchestrationRuntime);
      provideSessionTreeRuntime({ lifecycle }, sessionTreeRuntime);
      schedule = wireRuntimeSchedule(
        zhinAgent,
        options.im,
        options.projectRoot,
        assistantConfig,
        lifecycle,
      );
      scheduleTools = schedule.tools;
      assistantEnabled = schedule.assistantEnabled;
      lifecycle.add(schedule.dispose);

      const home = await wireRuntimeHome(
        options.projectRoot,
        assistantConfig,
        schedule.notificationRouter,
        schedule.bindCallHaService,
        schedule.defaultNotify,
      );
      homeTools = home.tools;
      lifecycle.add(home.dispose);
      if (home.homeActive) {
        logger.info(formatCompact({
          op: 'agent_host_home',
          enabled: true,
          watch: home.watchActive,
          tools: home.tools.length,
        }));
      }
    } catch (error) {
      throw new Error('Agent Host candidate initialization failed', { cause: error });
    }
    if (!zhinAgent || !composedRuntime) throw new Error('Agent Host candidate did not create a complete Agent runtime');

    const useDatabase = aiConfig.sessions?.useDatabase !== false;
    let persistencePendingActivate = false;
    if (useDatabase && resources.has(databaseRootHostToken)) {
      const database = resources.use(databaseRootHostToken);
      try {
        const tableCount = defineAiDatabaseModels((name, definition) => {
          database.define(name, definition);
        });
        persistencePendingActivate = true;
        handoff.add({
          activateNext: async () => {
            try {
              const raw = database.getRawDatabase();
              if (!raw) {
                logger.warn(formatCompact({
                  op: 'agent_host_persistence',
                  mode: 'memory',
                  reason: 'database_not_started',
                }));
                await wireCollaborationStorage(undefined, collaborationConfig);
                collaborationReady = true;
                return;
              }
              await activateAiDatabaseStorage(
                raw,
                { aiService: service, zhinAgent },
                aiConfig,
                collaborationConfig,
                orchService,
              );
              collaborationReady = true;
              logger.info(formatCompact({
                op: 'agent_host_persistence',
                mode: 'database',
                tables: tableCount,
                collaboration: 'on',
              }));
            } catch (error) {
              logger.warn(formatCompact({
                op: 'agent_host_persistence',
                mode: 'memory',
                reason: 'activate_failed',
                error: error instanceof Error ? error.message : String(error),
              }));
              try {
                await wireCollaborationStorage(undefined, collaborationConfig);
                collaborationReady = true;
              } catch {
                /* ignore */
              }
            } finally {
              zhinAgent.markMemoryPersistenceReady();
            }
          },
        });
      } catch (error) {
        logger.warn(formatCompact({
          op: 'agent_host_persistence',
          mode: 'memory',
          reason: 'define_failed',
          error: error instanceof Error ? error.message : String(error),
        }));
        zhinAgent.markMemoryPersistenceReady();
        void wireCollaborationStorage(undefined, collaborationConfig).then(() => {
          collaborationReady = true;
        });
      }
    } else {
      zhinAgent.markMemoryPersistenceReady();
      void wireCollaborationStorage(undefined, collaborationConfig).then(() => {
        collaborationReady = true;
      });
    }

    const bashTool = createBashTool();
    const ingress = new CapabilityIngress();
    const bootstrapText = await loadBootstrap(options.projectRoot);

    // Register before any await so a cancelled generation cannot leak Agent
    // Resources. DisposeStack continues through later cleanup when one
    // Resource fails.
    // Configured MCP joins the candidate's MCP projection. Its connection is
    // opened by generation activation and closed by rollback/retirement.
    for (const entry of mcpEntries) {
      const projected = projectHostMcp(entry);
      addFeature(projected.feature, projected.name, projected.definition);
    }

    for (const tool of [
      ...(options.extraTools ?? []),
      bashTool,
    ]) {
      if (!tool.description?.trim()) {
        throw new TypeError(`Host tool "${tool.name}" description cannot be empty`);
      }
      const projected = projectHostTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        approval: 'approval' in tool ? tool.approval : undefined,
        platforms: tool.platforms,
        scopes: tool.scopes,
        permissions: tool.permissions,
        hidden: tool.hidden,
        execute: (input) => tool.execute(input) as unknown | Promise<unknown>,
      });
      addFeature(projected.feature, projected.name, projected.definition);
    }

    for (const tool of [...scheduleTools, ...homeTools]) {
      addFeature(toolFeatureId, tool.name, tool.definition);
    }
    for (const tool of createNativeFileToolFeatures()) {
      addFeature(tool.feature, tool.name, tool.definition);
    }

    const orchestrator = zhinAgent.orchestrator;
    if (!orchestrator) {
      throw new Error('Agent Host requires a ready orchestrator before generation publication');
    }

    // Protocol Hosts (MCP/A2A) and Console consume this generation-owned port.
    // The Scope is sealed after all Root installers finish, so publication must
    // happen here rather than through a mutable process-global registry.
    resources.provide(agentHostToken, Object.freeze({
      service,
      agent: zhinAgent,
      introspection: Object.freeze({
        listTools: () => orchestrator.tools.getAll().map((tool) => Object.freeze({
          name: tool.name,
          description: tool.description,
          hidden: 'hidden' in tool && tool.hidden === true,
        })),
        listMcpServers: () => orchestrator.mcps.getAll().map((entry) => Object.freeze({
          name: entry.name,
          connected: orchestrator.mcps.isConnected(entry.name),
          toolCount: orchestrator.mcps.getToolsFromServer(entry.name).length,
        })),
      }),
      console: Object.freeze({
        sessionTree: sessionTreeRuntime,
        orchestration: orchestrationRuntime,
        assistant: schedule.assistantRuntime,
      }),
    }));
    resources.provide(
      turnJournalStoreToken,
      new FileJournalStore(join(options.projectRoot, '.zhin', 'agent-journal')),
    );
    resources.provide(agentTurnEngineToken, createFullAgentTurnEngine({
      host: asPrivate(zhinAgent),
      core: composedRuntime.agentCore,
      sessionSystem: composedRuntime.sessionSystem,
      contextSystem: composedRuntime.contextSystem,
      loopHooks: service.loopHooks,
      bootstrapContext: bootstrapText,
    }));

    const presetCount = await seedPresets();

    const binding = service.getBindingRegistry().requireZhinBinding();

    resources.provide(ingressRouteToken, Object.freeze({ route: async (
      message: Message,
      lease: import('@zhin.js/plugin-runtime').SnapshotLease,
      requester: PluginId,
    ) => {
      const snapshot = lease.value;
      const trigger = service.getTriggerConfig();
      const matched = matchAiTrigger(message, trigger);

      const ownerId = resolveOwnerForRuntimeMessage(message, options.resolveEndpointOwner);
      const endpointTrusted = resolveTrustedForRuntimeMessage(message, options.resolveEndpointTrusted);
      const senderRoles = resolveRuntimeSenderRoles(message, ownerId, endpointTrusted, trigger);
      const commMessage = bridgeRuntimeMessage(message, ownerId, senderRoles);

      // Boundary-only management/transcript projection still needs the legacy
      // command adapter; the Agent turn below consumes only TurnRequest.
      // Runtime message.adapter is a CapabilityId (\0-separated); strip it and
      // use Endpoint liveName so the OutboundHost resolve() succeeds.
      const effectiveAdapter = capabilityLocalName(String(message.conversation.endpoint.id));
      const effectiveEndpoint = adapterLiveEndpointId(message);
      if (effectiveAdapter && effectiveEndpoint) {
        (commMessage as { $adapter?: string }).$adapter = effectiveAdapter;
        (commMessage as { $endpoint?: string }).$endpoint = effectiveEndpoint;
      }

      // 入站流水 → im_transcripts（等待 projection settle，不能逃出 generation lease）。
      await recordRuntimeTranscript(zhinAgent, commMessage, {
        direction: 'inbound',
        body: message.content,
        messageId: message.id,
        senderId: resolveStableSenderId(message),
        senderName: message.sender?.name ?? message.sender?.id ?? '',
        senderRole: senderRoles.isMaster ? 'master' : senderRoles.isTrusted ? 'trusted' : 'user',
      });

      /** 回复并记录出站流水（assistant 角色，对齐 legacy message.send 收集）。 */
      const replyAndRecord = async (content: SendContent, transcriptBody = sendContentToText(content)) => {
        await message.$reply(content);
        await recordRuntimeTranscript(zhinAgent, commMessage, {
          direction: 'outbound',
          body: transcriptBody,
          senderRole: 'assistant',
        });
      };

      // 管理命令（原 MessageCommand /models /tree /reset…）— 在 AI trigger 前拦截
      const managementReply = await handleRuntimeManagementCommand({
        service,
        zhinAgent,
        commMessage,
        content: message.content,
        senderRoles,
      });
      if (managementReply != null) {
        await replyAndRecord(managementReply);
        logger.info(formatCompact({ op: 'agent_host_management', handled: true }));
        return true;
      }

      const approveReply = handleRuntimeOwnerApproveCommand(commMessage, message.content);
      if (approveReply != null) {
        await replyAndRecord(approveReply);
        logger.info(formatCompact({ op: 'agent_host_approve', handled: true }));
        return true;
      }

      if (!matched) {
        // 群/频道旁听：未触发 AI 的共享会话消息写入会话背景（Passive Group Context）。
        await recordPassiveGroupContext(zhinAgent, message, commMessage);
        return false;
      }

      if (isClearCommand(matched.content)) {
        await zhinAgent.archiveSessionForCommMessage(commMessage);
        await replyAndRecord('已清空本会话的 AI 多轮上下文。');
        return true;
      }

      let capabilityActive = true;
      try {
        const inbound = await preprocessInboundTurn(
          message,
          matched.content,
          options.transcribeUrl,
        );
        const capabilities = await readCapabilities(
          ingress,
          snapshot,
          requester,
          message,
          senderRoles,
          () => capabilityActive,
        );
        const routed = routeSpecialistAgent(inbound.text, capabilities);
        const collab = await applyRuntimeCollaborationInbound({
          message: commMessage,
          content: routed.userText,
          peerMode: resolvePeerMode(service.getTriggerConfig()),
          discoveredAgentNames: new Set(capabilities.agents.map((agent) => agent.name)),
          replyAi: async (payload) => {
            await replyAndRecord(typeof payload === 'string' ? payload : String(payload));
          },
          logger,
        });
        if (collab.action === 'skip') return true;
        if (collab.action === 'done') return true;

        // thinkingMessage：进入 AI 处理前先回占位（对齐 legacy inbound-turn-pipeline）。
        // 占位消息不 await 回包——平台 ack 慢（实测 icqq 守护进程 10s+）不应拖住 turn 启动；
        // 失败仅记日志（正式回复仍走 replyAndRecord 的完整确认）。
        if (trigger.thinkingMessage) {
          message.$reply(trigger.thinkingMessage).catch((error: unknown) => {
            logger.debug(formatCompact({
              op: 'agent_host_thinking_reply_failed',
              error: error instanceof Error ? error.message : String(error),
            }));
          });
          await recordRuntimeTranscript(zhinAgent, commMessage, {
            direction: 'outbound',
            body: sendContentToText(trigger.thinkingMessage as SendContent),
            senderRole: 'assistant',
          });
        }

        const outcome = await withTriggerTimeout(
          async (signal) => {
            const request = createRuntimeTurnRequest(message, routed.userText, senderRoles, {
              traceId: randomUUID(),
              turnId: randomUUID(),
              signal,
              workspaceRoot: options.projectRoot,
              ports: {
                ...(options.approvalPort ? { approval: options.approvalPort } : {}),
                reply: {
                  send: async (output) => {
                    const content = await publishOutboundElements([...output], effectiveAdapter || undefined);
                    if (content.length === 0) return { status: 'suppressed' as const };
                    await replyAndRecord(content, flattenOutputElements(output).trim());
                    return { status: 'sent' as const };
                  },
                },
              },
            });
            return options.runtime.executeLeased(
              lease,
              requester,
              request,
              { mcpServers: binding.mcpServers, agent: routed.agent?.qualifiedName ?? routed.agent?.name },
            );
          },
          resolveTriggerTimeoutMs(trigger),
        );
        const elements = completedOutput(outcome);
        const transcriptBody = flattenOutputElements(elements).trim();
        if (!transcriptBody) {
          // spawn_task 等委派回合 finalReply 为空：用户可见文案由 subagent auto-continue
          // + proactive 出站；勿把 '(empty AI response)' 当成正文发给用户。
          logger.debug(formatCompact({
            op: 'agent_host_turn_no_outbound',
            reason: 'empty_elements_delegated',
          }));
        }
        logger.debug(formatCompact({
          op: 'agent_host_turn',
          turnMode: 'agent_runtime.execute',
          tools: outcome.status === 'completed' ? capabilities.tools.length : 0,
          ingressTools: capabilities.tools.length,
          elements: elements.length,
          model: binding.model,
          provider: binding.providerAlias,
          stt: inbound.sttApplied,
          agent: routed.agent?.name ?? '-',
        }));
        return true;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(formatCompact({ op: 'agent_host_turn_fail', error: detail }));
        try {
          await replyAndRecord(renderTriggerError(trigger, detail));
        } catch {
          /* ignore reply failure */
        }
        return true;
      } finally {
        capabilityActive = false;
      }
    }}));

    const providers = service.listProviders();
    const features = [
      zhinAgent.getSubagentSystem() ? 'subagent' : '',
      options.transcribeUrl ? 'inboundStt' : '',
      scheduleTools.length > 0 ? 'schedule' : '',
      homeTools.length > 0 ? 'home' : '',
      assistantEnabled ? 'assistant' : '',
      collaborationReady || persistencePendingActivate ? 'collaboration' : '',
      'bash',
      options.resolveEndpointOwner ? 'approve' : '',
    ].filter(Boolean).join(',');
    logger.info(
      `ready | ${binding.name}@${binding.providerAlias}/${binding.model}`
      + ` | providers: ${providers.length}`
      + ` | presets: ${presetCount}`
      + ` | mcp: ${mcpEntries.map((entry) => entry.name).join(',') || '-'}`
      + ` | ${features}`
      + ` | persistence: ${persistencePendingActivate ? 'pending_activate' : 'memory'}`,
    );
    logger.debug(
      `ready detail | providers: ${providers.join(',')}`
      + ` | mcp: ${mcpEntries.map((entry) => entry.name).join(',') || '-'}`
      + ` | tools: ${(options.extraTools ?? []).map((tool) => tool.name).join(',') || '-'}`,
    );
  };
}

/**
 * Persist schedule-jobs.json + schedule_* tools for Plugin Runtime Agent Host.
 * When `assistant.enabled`, also sync profile routines and register Event Ingress.
 */
function wireRuntimeSchedule(
  agent: ZhinAgent,
  im: ImRuntime,
  projectRoot: string,
  assistantRaw: AssistantConfig | undefined,
  lifecycle: DisposeStack,
): {
  tools: ReturnType<typeof createScheduleTools>;
  dispose: () => void;
  assistantEnabled: boolean;
  notificationRouter: ReturnType<typeof createNotificationRouter>;
  defaultNotify: ReturnType<typeof parseJobNotify> | undefined;
  bindCallHaService: (fn: (service: string, target?: string, data?: unknown) => Promise<void>) => void;
  assistantRuntime: AssistantRuntimeHandle | null;
} {
  const dataDir = join(projectRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  const assistantCfg = resolveAssistantConfig(assistantRaw);
  const defaults = resolveAssistantDefaultsConfig(assistantCfg.defaults);
  let defaultNotify = defaults.notify;
  if (defaultNotify) {
    try {
      defaultNotify = parseJobNotify(defaultNotify);
    } catch {
      defaultNotify = undefined;
    }
  }

  let callHaServiceImpl: ((service: string, target?: string, data?: unknown) => Promise<void>) | undefined;
  const bindCallHaService = (fn: (service: string, target?: string, data?: unknown) => Promise<void>) => {
    callHaServiceImpl = fn;
  };

  const proactiveOutbound = createRuntimeProactiveOutbound(im);
  const notificationRouter = createNotificationRouter({
    resolveAdapter: () => undefined,
    sendIm: async (notify, content, source) => {
      await proactiveOutbound.send({
        scene: notify.target.scene,
        source: (source ?? 'scheduled') as import('@zhin.js/agent').ProactiveSendSource,
      }, content);
    },
    callHaService: async (service, target, data) => {
      if (callHaServiceImpl) {
        await callHaServiceImpl(service, target, data);
        return;
      }
      logger.info(formatCompact({
        op: 'job_notify_ha_stub',
        service,
        target,
      }));
    },
  });
  const executor = createTaskExecutor({
    agent,
    dataDir,
    resolveAdapter: () => undefined,
    router: notificationRouter,
    defaultNotify,
  });

  const store = createScheduleJobStoreFromConfig(dataDir, {
    defaultNotify,
  });
  const jobWorker = new JobWorker({
    executor,
    queue: assistantCfg.queue,
    assistantEnabled: assistantCfg.enabled,
  });
  const jobEngine = new ScheduleJobEngine({
    store,
    worker: jobWorker,
    notifyOnFailure: defaults.notifyOnFailure,
    router: notificationRouter,
    defaultNotify,
  });

  const scheduleManager = {
    scheduleFeature: {
      getStatus: () => [],
    },
    engine: jobEngine,
    previewTask: (prompt: string, context: import('@zhin.js/agent').ScheduleInvocationContext, options?: { activityFeedback?: boolean }) =>
      executor.preview(prompt, context, options),
  };

  let assistantRuntime: AssistantRuntimeHandle | null = null;
  if (assistantCfg.enabled) {
    const ingress = new AssistantEventIngress({
      store,
      engine: jobEngine,
      eventsConfig: assistantCfg.events,
    });
    assistantRuntime = {
      config: assistantCfg,
      store,
      engine: jobEngine,
      ingress,
    };
    provideAssistantRuntime({ lifecycle }, assistantRuntime);
    void (async () => {
      const profile = await loadAssistantProfileFile(projectRoot, assistantCfg.profile);
      if (profile) {
        for (const err of validateAssistantProfile(profile)) {
          logger.warn(formatCompact({ assistant_profile: err }));
        }
      }
      await syncProfileHeartbeatToStore(store, profile);
      await syncProfileRoutinesToStore(store, profile);
      await pruneStaleProfileCronJobs(store, profile);
      jobEngine.load();
    })().catch((error) => {
      logger.warn(formatCompact({
        op: 'assistant_profile_load_fail',
        error: error instanceof Error ? error.message : String(error),
      }));
      jobEngine.load();
    });
    logger.info(formatCompact({
      op: 'agent_host_assistant',
      enabled: true,
      events: ingress.isEnabled(),
      profile: assistantCfg.profile?.enabled === true,
    }));
  } else {
    provideAssistantRuntime({ lifecycle }, null);
    jobEngine.load();
  }

  const tools = createScheduleTools(scheduleManager);

  return {
    tools,
    assistantEnabled: assistantCfg.enabled,
    notificationRouter,
    defaultNotify,
    bindCallHaService,
    assistantRuntime,
    // assistant / schedule-manager 注册随 generation lifecycle 反注册（provide 时挂接）
    dispose: () => {
      jobEngine.unload();
      jobWorker.stop();
    },
  };
}

async function wireRuntimeHome(
  projectRoot: string,
  assistantRaw: AssistantConfig | undefined,
  notificationRouter: ReturnType<typeof createNotificationRouter>,
  bindCallHaService: (fn: (service: string, target?: string, data?: unknown) => Promise<void>) => void,
  defaultNotify: ReturnType<typeof parseJobNotify> | undefined,
): Promise<{
  tools: BootstrapAssistantHomeResult['tools'];
  dispose: () => void;
  homeActive: boolean;
  watchActive: boolean;
}> {
  const assistantCfg = resolveAssistantConfig(assistantRaw);
  const result = await bootstrapAssistantHome({
    homeRaw: assistantCfg.home,
    profile: assistantCfg.profile,
    projectRoot,
    notificationRouter,
    defaultNotify,
    bindCallHaService,
    log: (payload) => logger.info(formatCompact(payload)),
  });
  return {
    tools: result.tools,
    dispose: result.dispose,
    homeActive: result.homeActive,
    watchActive: result.watchActive,
  };
}

function resolvePeerMode(trigger?: AITriggerConfig): PeerTriggerMode {
  const mode = trigger?.peerMode;
  if (mode === 'off' || mode === 'mention-only') return mode;
  return 'mention-only';
}

function createRuntimeZhinAgent(
  service: AIService,
  im: ImRuntime,
  projectRoot: string,
  approvalPort?: ApprovalPort,
): {
  agent: ZhinAgent;
  runtime: ReturnType<typeof composeZhinAgentRuntime>;
  seedPresets: () => Promise<number>;
} {
  const binding = service.getBindingRegistry().requireZhinBinding();
  const provider = service.getProvider(binding.providerAlias);
  const agent = new ZhinAgent(provider, {
    ...(service.getAgentConfig() ?? {}),
    chatModel: binding.model,
  });
  asPrivate(agent).approvalPort = approvalPort;
  const composed = composeZhinAgentRuntime(agent, provider, createRuntimeProactiveOutbound(im));
  const orchestrator = new AgentOrchestrator();
  agent.configure({
    agentCore: composed.agentCore,
    toolSystem: composed.toolSystem,
    contextSystem: composed.contextSystem,
    memorySystem: composed.memorySystem,
    sessionSystem: composed.sessionSystem,
    eventSystem: composed.eventSystem,
    orchestrator,
    providerResolver: (alias) => service.getProvider(alias),
    activeBinding: binding,
    deferredResultSender: composed.deliverOutbound,
    subagentSender: composed.deliverOutbound,
  });

  agent.initSubagentSystem(() => buildRuntimeSubagentAgentTools(projectRoot));
  agent.getSubagentSystem()?.configureRouting({
    getProvider: (alias) => service.getProvider(alias),
    resolveBinding: (name) => service.getBindingRegistry().getBinding(name),
    getMcpRegistry: () => null,
    resolveAgentMeta: async (name) => {
      const metas = await discoverWorkspaceAgents(null, projectRoot);
      return metas.find((meta) => meta.name === name) ?? null;
    },
    getParentContextSnapshot: (origin) => agent.buildParentContextSnapshotForSubagent(origin),
  });

  // Persistence readiness is latched after DatabaseHost activateNext (or
  // immediately when sessions.useDatabase === false / no DatabaseHost).
  return {
    agent,
    runtime: composed,
    seedPresets: () => seedOrchestratorAgentPresets(orchestrator, projectRoot),
  };
}

function buildRuntimeSubagentAgentTools(projectRoot: string) {
  const plainTools: Tool[] = [
    createReadFileTool(),
    createWriteFileTool(),
    createEditFileTool(),
    createListDirTool(),
    createGlobTool(),
    createGrepTool(),
    createWebSearchTool(),
    createWebFetchTool(),
    createBashTool(),
  ];
  return plainTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    source: 'builtin',
    execute: tool.execute as (args: Record<string, unknown>) => Promise<unknown>,
    tags: tool.tags,
    keywords: tool.keywords,
  }));
}

async function seedOrchestratorAgentPresets(
  orchestrator: AgentOrchestrator,
  projectRoot: string,
): Promise<number> {
  try {
    const metas = await discoverWorkspaceAgents(null, projectRoot);
    for (const meta of metas) {
      if (orchestrator.subagents.getPreset(meta.name)) continue;
      orchestrator.addAgentPreset({
        name: meta.name,
        description: meta.description,
        systemPrompt: '',
        tools: meta.toolNames,
        model: meta.model,
        filePath: meta.filePath,
        pluginName: meta.ownerPlugin,
      });
    }
    if (metas.length > 0) {
      logger.info(formatCompact({
        op: 'agent_host_presets',
        count: metas.length,
        names: metas.map((meta) => meta.name).join(','),
      }));
    }
    return metas.length;
  } catch (error) {
    logger.warn(formatCompact({
      op: 'agent_host_presets_fail',
      error: error instanceof Error ? error.message : String(error),
    }));
    return 0;
  }
}

function createRuntimeProactiveOutbound(im: ImRuntime): ProactiveOutboundService {
  return {
    async send(ctx, content) {
      const result = await im.sendEndpointMessage({
        adapter: ctx.scene.platform,
        endpointKey: ctx.scene.endpointKey,
        conversation: {
          kind: ctx.scene.kind as 'private' | 'group' | 'channel',
          id: ctx.scene.sceneId,
        },
        content,
      });
      return result.messageId || 'ok';
    },
    async sendElements(ctx, elements) {
      const content = await publishOutboundElements(elements, ctx.scene.platform);
      if (content.length === 0) return [];
      const id = await this.send(ctx, content);
      return [id];
    },
  };
}

interface RuntimeSenderRoles {
  readonly isMaster: boolean;
  readonly isTrusted: boolean;
}

/**
 * 对齐 legacy resolveSenderRoles（ai-trigger.ts:260）：
 * trigger.masters ∪ endpoint master → master 角色（审批放行）；
 * trigger.trusted ∪ endpoint trusted → trusted 角色（弱于 master，不参与 Owner 审批）。
 */
export function resolveRuntimeSenderRoles(
  message: Message,
  endpointMaster: string | undefined,
  endpointTrusted: readonly string[],
  trigger?: AITriggerConfig,
): RuntimeSenderRoles {
  const senderId = message.sender?.id ?? resolveAuthenticatedSenderId(message);
  const triggerMasters = (trigger?.masters ?? []).map(String);
  const triggerTrusted = (trigger?.trusted ?? []).map(String);
  const isMaster = senderId != null
    && ((endpointMaster != null && senderId === String(endpointMaster))
      || triggerMasters.includes(senderId));
  const isTrusted = !isMaster && senderId != null
    && (triggerTrusted.includes(senderId) || endpointTrusted.map(String).includes(senderId));
  return { isMaster, isTrusted };
}

export function bridgeRuntimeMessage(
  message: Message,
  endpointMaster: string | undefined,
  roles: RuntimeSenderRoles,
) {
  const localName = capabilityLocalName(String(message.conversation.endpoint.id));
  const channelType = resolveChannelType(message);
  const channelId = resolveChannelId(message);
  const endpointKey = message.endpointId
    || String(message.metadata?.endpoint ?? message.metadata?.endpointKey ?? localName);
  const senderId = resolveStableSenderId(message);
  const quoteId = message.replyTo?.id ?? (typeof message.metadata?.quote_id === 'string' ? message.metadata.quote_id : undefined);
  // 入站结构化段：纯文本视图（matched.content）会丢弃媒体，这里把 canonical
  // segments 与提取出的媒体引用（image/audio/video/file 的 MediaRef）挂到
  // synthetic message 的 extra，AI turn 与工具经 resolveContextKey 可读。
  // Message.extra keeps the original adapter segments for extension code, while
  // AI media extraction reads the canonical form from the single ingress mapper.
  const segmentMedia = collectSegmentMedia(
    message.segments ? toCanonicalSegments(message.segments) : undefined,
  );
  return createSyntheticMessage({
    adapter: localName,
    endpoint: endpointKey,
    id: message.id,
    ...(typeof quoteId === 'string' && quoteId ? { quote_id: quoteId } : {}),
    sender: {
      id: senderId,
      name: message.sender?.name,
      role: message.sender?.roles?.[0],
      isMaster: roles.isMaster,
      isTrusted: roles.isTrusted,
    },
    channel: {
      type: channelType,
      id: channelId,
    },
    reply: async (content) => {
      // canonical Segment 是一等 SendContent：媒体段原样透传，不再压平为文本
      await message.$reply(content as SendContent);
      return message.id ?? 'ok';
    },
    extra: {
      ...message.metadata,
      ...(message.segments?.length ? { segments: message.segments } : {}),
      ...(segmentMedia.length > 0 ? { media: segmentMedia } : {}),
      ...(endpointMaster ? { endpointMaster } : {}),
    },
  });
}

/**
 * Canonical IM → Agent TurnRequest mapper. Runtime Message remains owned by IM.
 */
export function createRuntimeTurnRequest(
  message: Message,
  text: string,
  roles: RuntimeSenderRoles,
  input: Readonly<{
    traceId: string;
    turnId: string;
    signal: AbortSignal;
    workspaceRoot: string;
    ports: TurnRequestPorts;
  }>,
): TurnRequest {
  const access = createRuntimeTurnAccess(message, roles);
  const origin = access.origin;
  if (origin.kind !== 'im') throw new Error('Runtime IM ingress must produce an IM origin');
  const media = collectSegmentMedia(
    message.segments ? toCanonicalSegments(message.segments) : undefined,
  ).map(({ type, media: ref }) => Object.freeze({
    kind: type as 'image' | 'audio' | 'video' | 'file',
    source: Object.freeze({
      kind: ref.kind === 'file' ? 'platform_ref' as const : ref.kind,
      value: ref.value,
    }),
    ...(ref.mime_type ? { mimeType: ref.mime_type } : {}),
    ...(ref.file_name ? { name: ref.file_name } : {}),
  }));
  const quoteId = message.replyTo?.id
    ?? (typeof message.metadata?.quote_id === 'string' ? message.metadata.quote_id : undefined);
  const quoteText = typeof message.metadata?.quote_text === 'string'
    ? message.metadata.quote_text.trim()
    : undefined;

  return Object.freeze({
    identity: Object.freeze({ traceId: input.traceId, turnId: input.turnId }),
    origin,
    principal: access.principal,
    input: Object.freeze({
      text,
      ...(media.length > 0 ? { media: Object.freeze(media) } : {}),
      ...(quoteId || quoteText
        ? { quote: Object.freeze({ ...(quoteId ? { messageId: quoteId } : {}), ...(quoteText ? { text: quoteText } : {}) }) }
        : {}),
      metadata: Object.freeze({ ...message.metadata }),
    }),
    session: Object.freeze({
      key: `${origin.platform}:${origin.endpoint}:${origin.scope}:${origin.sceneId}`,
    }),
    policy: Object.freeze({
      ...access.policy,
      filesystem: Object.freeze({ workspaceRoot: input.workspaceRoot }),
    }),
    signal: input.signal,
    ports: Object.freeze({ ...input.ports }),
  });
}

function createRuntimeTurnAccess(
  message: Message,
  roles: RuntimeSenderRoles,
): TurnAccessContext {
  const platform = capabilityLocalName(String(message.conversation.endpoint.id));
  const endpoint = message.endpointId?.trim();
  if (!endpoint) throw new TypeError('Runtime IM ingress requires endpoint identity');
  const subjectId = message.sender?.id?.trim();
  if (!subjectId) throw new TypeError('Runtime IM ingress requires authenticated sender identity');
  const scope = resolveChannelType(message);
  const trustRole = roles.isMaster ? 'master' : roles.isTrusted ? 'trusted' : 'user';
  const principalRoles = [...new Set([...(message.sender?.roles ?? []), trustRole])];
  return Object.freeze({
    origin: Object.freeze({
      kind: 'im' as const,
      platform,
      endpoint,
      scope,
      sceneId: resolveChannelId(message),
      ...(message.id ? { messageId: message.id } : {}),
    }),
    principal: Object.freeze({
      subjectId,
      ...(message.sender?.name ? { displayName: message.sender.name } : {}),
      roles: Object.freeze(principalRoles),
    }),
    policy: Object.freeze({
      permissions: Object.freeze(principalRoles),
      unattended: false,
    }),
  });
}

function resolveOwnerForRuntimeMessage(
  message: Message,
  resolve?: InstallAgentHostOptions['resolveEndpointOwner'],
): string | undefined {
  if (!resolve) return undefined;
  const localName = capabilityLocalName(String(message.conversation.endpoint.id));
  const endpointKey = String(
    message.metadata?.endpoint
    ?? message.metadata?.endpointKey
    ?? localName,
  );
  return resolve(localName, endpointKey) ?? resolve(endpointKey, endpointKey);
}

function resolveTrustedForRuntimeMessage(
  message: Message,
  resolve?: InstallAgentHostOptions['resolveEndpointTrusted'],
): readonly string[] {
  if (!resolve) return [];
  const localName = capabilityLocalName(String(message.conversation.endpoint.id));
  const endpointKey = String(
    message.metadata?.endpoint
    ?? message.metadata?.endpointKey
    ?? localName,
  );
  const merged = [...resolve(localName, endpointKey), ...resolve(endpointKey, endpointKey)];
  return [...new Set(merged.map((id) => String(id).trim()).filter(Boolean))];
}

interface RuntimeTranscriptDraft {
  readonly direction: 'inbound' | 'outbound';
  readonly body: string;
  readonly messageId?: string;
  readonly senderId?: string;
  readonly senderName?: string;
  readonly senderRole?: string;
}

/**
 * im_transcripts 落库（缺口 1，对齐 legacy register-chat-message-store）。
 * scene 字段经 resolveSceneFieldsFromMessage 计算，与 chat_history 工具查询
 * （buildImTranscriptQuery）保持同一 SSOT；调用方等待 projection settle。
 */
export function recordRuntimeTranscript(
  agent: Pick<ZhinAgent, 'recordImTranscript'>,
  commMessage: ReturnType<typeof createSyntheticMessage>,
  draft: RuntimeTranscriptDraft,
): Promise<void> {
  const body = draft.body ?? '';
  if (!body.trim()) return Promise.resolve();
  const scene = resolveSceneFieldsFromMessage(commMessage);
  const input: ImTranscriptWriteInput = {
    message_id: draft.messageId ?? '',
    platform: scene.platform,
    endpoint_id: scene.endpointKey,
    scene_id: scene.sceneId,
    scene_type: scene.sceneType,
    sender_id: draft.senderId ?? scene.endpointKey,
    sender_name: draft.senderName ?? scene.endpointKey,
    sender_role: draft.senderRole ?? 'user',
    direction: draft.direction,
    body,
    time: Date.now(),
  };
  return agent.recordImTranscript(input).catch((error) => {
    logger.debug(formatCompact({
      op: 'agent_host_transcript_fail',
      direction: draft.direction,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
}

/**
 * 群/频道旁听（缺口 2，对齐 legacy register-group-session-passive）：
 * 未触发 AI 的共享会话消息写入 Passive Group Context，供后续 @ 时带入上下文。
 * 仅群/频道生效（私聊 / sandbox 不旁听，与 legacy dispatcher 适用范围一致）。
 */
export async function recordPassiveGroupContext(
  agent: Pick<ZhinAgent, 'recordPassiveGroupObservation'>,
  message: Message,
  commMessage: ReturnType<typeof createSyntheticMessage>,
): Promise<void> {
  const channelType = resolveChannelType(message);
  if (channelType !== 'group' && channelType !== 'channel') return;
  const rawText = message.content.trim();
  if (!rawText) return;
  // 机器人自身消息不旁听（对齐 legacy isBotSelfMessage）。
  const senderId = resolveStableSenderId(message);
  const endpointKey = String(commMessage.$endpoint ?? '');
  if (senderId !== '' && endpointKey !== '' && senderId === endpointKey) return;
  try {
    const sceneService = getCollaborationSceneService();
    let cell = findCellForInbound(
      sceneService.listScenes(),
      String(commMessage.$adapter),
      String(commMessage.$channel?.id ?? ''),
      endpointKey,
    );
    if (cell) {
      cell = (await sceneService.getSceneFresh(cell.id)) ?? cell;
    }
    await agent.recordPassiveGroupObservation({
      sessionKey: resolveAgentTurnSessionKey(commMessage, cell),
      senderId: resolveStableSenderId(message),
      senderName: message.sender?.name ?? resolveStableSenderId(message),
      text: rawText,
    });
  } catch (error) {
    logger.debug(formatCompact({
      op: 'agent_host_passive_fail',
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

/** ai.trigger.timeout（默认 60000，对齐 legacy DEFAULT_AI_TRIGGER_CONFIG）。 */
const DEFAULT_TRIGGER_TIMEOUT_MS = 60_000;
/** ai.trigger.errorTemplate 默认值，对齐 legacy DEFAULT_AI_TRIGGER_CONFIG。 */
const DEFAULT_TRIGGER_ERROR_TEMPLATE = '❌ AI 处理失败: {error}';

export function resolveTriggerTimeoutMs(trigger?: AITriggerConfig): number {
  const raw = trigger?.timeout;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_TRIGGER_TIMEOUT_MS;
}

export function renderTriggerError(trigger: AITriggerConfig | undefined, detail: string): string {
  const template = trigger?.errorTemplate?.trim()
    ? trigger.errorTemplate
    : DEFAULT_TRIGGER_ERROR_TEMPLATE;
  return template.replace('{error}', detail);
}

export class TriggerTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AI 处理超时（${timeoutMs}ms）`);
    this.name = 'TriggerTimeoutError';
  }
}

/**
 * Runs one ingress-owned turn with a cancellation signal. On timeout the
 * signal reaches the inbound queue, PromptController, provider stream, and
 * tool execution instead of merely hiding a late result.
 */
export function withTriggerTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T>;
/** @deprecated Promise inputs cannot be cancelled; pass a signal-aware callback. */
export function withTriggerTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T>;
export function withTriggerTimeout<T>(
  work: Promise<T> | ((signal: AbortSignal) => Promise<T>),
  timeoutMs: number,
): Promise<T> {
  if (typeof work === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new TriggerTimeoutError(timeoutMs)), timeoutMs);
    return work(controller.signal).finally(() => clearTimeout(timer));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TriggerTimeoutError(timeoutMs));
    }, timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function resolveChannelId(message: Message): string {
  return message.conversation.id || (message.sender?.id ?? 'unknown');
}

function capabilityLocalName(id: string): string {
  const parts = id.split('\0');
  const local = parts.length >= 3 ? parts[2]! : id;
  // 展开 id 形如 `slot~entry`（多 endpoint）：adapter 名取 slot localName
  return local.split('~')[0]!;
}

/** Endpoint liveName (e.g. ICQQ uin, sandbox bot name) — first-class field, metadata fallback. */
function adapterLiveEndpointId(message: Message): string {
  if (message.endpointId) return message.endpointId;
  const live = String(message.metadata?.endpoint ?? message.metadata?.endpointKey ?? '');
  if (live) return live;
  return capabilityLocalName(String(message.conversation.endpoint.id));
}

function resolveChannelType(
  message: Message,
): 'private' | 'group' | 'channel' {
  return message.conversation.kind;
}

/**
 * 稳定发送者 ID：sender.id 是适配器从平台 API 传入的一等字段（稳定平台 ID），
 * metadata userId/user_id 降为 fallback（兼容尚未迁移的适配器）。
 */
function resolveStableSenderId(message: Message): string {
  return message.sender?.id ?? resolveAuthenticatedSenderId(message) ?? 'anon';
}

/**
 * Fallback sender identity from metadata. Only used when sender.id is absent
 * (legacy adapters that haven't migrated to MessageSenderRef).
 */
function resolveAuthenticatedSenderId(message: Message): string | undefined {
  for (const key of ['userId', 'user_id', 'senderId'] as const) {
    const value = message.metadata?.[key];
    if (value != null && String(value).trim()) return String(value);
  }
  return undefined;
}

function isClearCommand(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  return normalized === 'clear'
    || normalized === '/clear'
    || normalized === '重置'
    || normalized === '清空';
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

async function readCapabilities(
  ingress: CapabilityIngress,
  snapshot: RuntimeSnapshot,
  requester: PluginId,
  message: Message,
  roles: RuntimeSenderRoles,
  isActive: () => boolean,
): Promise<AgentCapabilities> {
  return ingress.read(snapshot, requester, isActive, createRuntimeTurnAccess(message, roles));
}

export function runtimeApprovalPolicy(
  approval: ToolCapability['approval'],
): 'never' | 'always' | 'once' | 'on-risk' {
  return approval;
}

/** A small non-interactive ApprovalPort suitable for CLI/service hosts and tests. */
export function createDeterministicApprovalPort(
  decision: 'approve' | 'deny' = 'deny',
): ApprovalPort {
  return {
    available: true,
    requestApproval: async () => decision === 'approve',
  };
}

function parseMcpServers(raw: AIConfig['mcpServers']): McpServerEntry[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new TypeError('ai.mcpServers must be an array');
  return raw.map((item, index) => {
    const entry = toMcpServerEntry(item);
    if (!entry) throw new TypeError(`Invalid ai.mcpServers[${index}] declaration`);
    return entry;
  });
}

function toMcpServerEntry(raw: McpServerConfig): McpServerEntry | null {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const transport = raw.transport;
  if (transport !== 'stdio' && transport !== 'streamable-http' && transport !== 'sse') return null;
  if (transport === 'stdio') {
    if (!raw.command?.trim()) return null;
  } else if (!raw.url?.trim()) {
    return null;
  }
  return {
    name: raw.name.trim(),
    transport,
    url: raw.url,
    command: raw.command,
    args: raw.args,
    env: raw.env,
    headers: raw.headers,
  };
}

function completedOutput(
  outcome: TurnOutcome,
): Array<Extract<TurnOutcome, { status: 'completed' }>['output'][number]> {
  if (outcome.status === 'completed') return [...outcome.output];
  if (outcome.status === 'cancelled') {
    throw new Error(`Agent turn cancelled: ${outcome.reason}`);
  }
  if (outcome.status === 'budget_exceeded') {
    throw new Error(`Agent turn exceeded budget: ${outcome.budget}`);
  }
  throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
}

async function preprocessInboundTurn(
  message: Message,
  content: string,
  transcribeUrl?: (audioUrl: string) => Promise<string | null>,
): Promise<{ readonly text: string; readonly sttApplied: boolean }> {
  const audioUrl = resolveInboundAudioUrl(message);
  if (!audioUrl || !transcribeUrl) {
    return { text: stripAudioPlaceholders(content), sttApplied: false };
  }
  const transcript = await transcribeUrl(audioUrl);
  if (!transcript) {
    return { text: stripAudioPlaceholders(content) || content, sttApplied: false };
  }
  const rest = stripAudioPlaceholders(content).trim();
  const text = rest ? `${rest}\n${transcript}` : transcript;
  return { text, sttApplied: true };
}

function resolveInboundAudioUrl(
  message: Message,
): string | undefined {
  if (message.segments) {
    for (const seg of message.segments) {
      if (seg.type === 'audio' || seg.type === 'record') {
        const media = seg.data?.media as { kind?: string; value?: string } | undefined;
        if (media?.kind === 'url' && typeof media.value === 'string' && media.value.trim()) {
          return media.value.trim();
        }
        const d = seg.data as Record<string, unknown> | undefined;
        const url = d?.url ?? d?.src ?? d?.file;
        if (typeof url === 'string' && url.trim()) return url.trim();
      }
    }
  }
  const fromMeta = message.metadata?.audio_url;
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();
  const match = message.content.match(/\[audio:([^\]]+)\]/u);
  const fromContent = match?.[1]?.trim();
  return fromContent || undefined;
}

function stripAudioPlaceholders(content: string): string {
  return content.replace(/\[audio:[^\]]*\]/gu, '').trim();
}

function routeSpecialistAgent(
  userText: string,
  capabilities: AgentCapabilities,
): { readonly userText: string; readonly agent?: AgentCapabilities['agents'][number] } {
  const match = userText.match(/^@([^\s:：]+)[:：]?\s*/u);
  if (!match) return { userText };
  const name = match[1]!.toLowerCase();
  const agent = capabilities.agents.find((item) => item.name.toLowerCase() === name);
  if (!agent) return { userText };
  return { userText: userText.slice(match[0].length).trim() || userText, agent };
}

/**
 * 默认值与 legacy `DEFAULT_AI_TRIGGER_CONFIG`
 * （packages/im/core/src/built/ai-trigger.ts）对齐。
 */
const DEFAULT_AI_TRIGGER_PREFIXES = ['#', 'AI:', 'ai:'];
const DEFAULT_AI_TRIGGER_IGNORE_PREFIXES = ['/', '!', '！'];

/**
 * 新 Plugin Runtime 的 AI 触发判定，对齐 legacy `shouldTriggerAI` 的顺序：
 * ignorePrefixes → 前缀 → @(群/频道，metadata.mentioned) → 私聊 → 关键词(仅单人会话)。
 *
 * 与 legacy 的差异：Runtime Message.content 为纯文本，at 信息由适配器经
 * `metadata.mentioned: true` 标注（icqq 扫 CQ 码、QQ 官方看 AT 事件、slack 看
 * app_mention）；且前缀触发对群聊同样生效（test-bot 群聊依赖 `ai:` 前缀，
 * legacy 群/频道仅 @ 触发）。
 */
export function matchAiTrigger(
  message: Message,
  trigger: AITriggerConfig | undefined,
): { content: string } | null {
  if (trigger && trigger.enabled === false) return null;
  const text = message.content.trim();
  if (!text) return null;

  // 0. 忽略前缀（命令前缀，避免与命令冲突）
  const ignorePrefixes = trigger?.ignorePrefixes?.length
    ? trigger.ignorePrefixes
    : DEFAULT_AI_TRIGGER_IGNORE_PREFIXES;
  for (const prefix of ignorePrefixes) {
    if (prefix && text.startsWith(prefix)) return null;
  }

  const isPrivate = isPrivateRuntimeMessage(message);

  // 1. 前缀触发（与 legacy 差异：群聊同样生效，见 docs/advanced/ai.md）
  const prefixes = trigger?.prefixes?.length ? trigger.prefixes : DEFAULT_AI_TRIGGER_PREFIXES;
  for (const prefix of prefixes) {
    if (!prefix) continue;
    if (text.startsWith(prefix)) {
      const content = text.slice(prefix.length).trim();
      return content ? { content } : null;
    }
  }

  // 2. @ 触发（群/频道主路径；剥离提及后为空也触发，与 legacy 一致）
  const respondToAt = trigger?.respondToAt !== false;
  if (respondToAt && !isPrivate && (message.mentioned === true || message.metadata?.mentioned === true)) {
    return { content: stripMentionMarkup(text) };
  }

  // 3. 私聊直接对话
  const respondToPrivate = trigger?.respondToPrivate !== false;
  if (respondToPrivate && isPrivate) {
    return { content: text };
  }

  // 4. 关键词触发（仅私聊等单人会话，避免群聊旁听误触发，与 legacy 一致）
  const keywords = trigger?.keywords ?? [];
  if (isPrivate && keywords.length > 0) {
    const lowerText = text.toLowerCase();
    for (const keyword of keywords) {
      if (keyword && lowerText.includes(keyword.toLowerCase())) {
        return { content: text };
      }
    }
  }

  return null;
}

/** 剥离 @ 触发后残留的提及标记：icqq CQ 码、QQ 官方/频道与 Slack 的 `<@!id>`。 */
function stripMentionMarkup(text: string): string {
  return text
    .replace(/\[CQ:(?:at|mention),[^\]]*\]/giu, '')
    .replace(/<@!?[^>\s]+>/gu, '')
    .replace(/\[(?:at|mention):[^\]]*\]/giu, '')
    .trim();
}

function isPrivateRuntimeMessage(message: Message): boolean {
  return message.conversation.kind === 'private';
}

function flattenOutputElements(elements: readonly OutputElementLike[]): string {
  const parts: string[] = [];
  for (const el of elements) {
    switch (el.type) {
      case 'text':
        if (el.content) parts.push(el.content);
        break;
      case 'image':
        parts.push(el.url ? `[image:${el.url}]` : '[image]');
        break;
      case 'audio':
        parts.push(el.fallbackText || (el.url ? `[audio:${el.url}]` : '[audio]'));
        break;
      case 'video':
        parts.push(el.fallbackText || (el.url ? `[video:${el.url}]` : '[video]'));
        break;
      case 'card': {
        const card = [el.title ?? 'card'];
        if (el.description) card.push(el.description);
        parts.push(card.join('\n'));
        break;
      }
      case 'file':
        parts.push(el.url ? `${el.name ?? 'file'}: ${el.url}` : (el.name ?? '[file]'));
        break;
    }
  }
  return parts.join('\n');
}

function sendContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => sendContentToText(item)).filter(Boolean).join('\n');
  }
  if (content && typeof content === 'object' && 'type' in content) {
    return flattenOutputElements([content as OutputElementLike]);
  }
  return content == null ? '' : String(content);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

async function readConfigDocument(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<unknown> {
  if (!isConfigDocumentPort(config)) return config;
  return (await config.read()).document;
}

function isConfigDocumentPort(value: unknown): value is ConfigDocumentPort {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConfigDocumentPort>;
  return typeof candidate.read === 'function';
}
