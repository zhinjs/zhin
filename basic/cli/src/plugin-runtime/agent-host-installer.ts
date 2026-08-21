import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  collectSegmentMedia,
  toCanonicalSegments,
  type AITriggerConfig,
  type Tool,
} from '@zhin.js/core';
import { ingressRouteToken, type ImRuntime, type Message, type SendContent } from '@zhin.js/core/runtime';
import type { CommandPrompt } from '@zhin.js/command';
import {
  expandEnvironmentValue,
  type ConfigDocumentPort,
  type RootResourceInstaller,
  type RuntimeConfigDocument,
} from '@zhin.js/runtime';
import { databaseRootHostToken, rootPluginId, type DisposeStack, type PluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  AIService,
  ZhinAgent,
  composeZhinAgentRuntime,
  AgentOrchestrator,
  discoverWorkspaceAgents,
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
  handleRuntimeOwnerApproveCommand,
  handleRuntimeManagementCommand,
  publishOutboundElements,
  type ProactiveOutboundService,
  type AssistantConfig,
  type AssistantRuntimeHandle,
  type BootstrapAssistantHomeResult,
  type OrchestrationRuntimeHandle,
  type SessionTreeRuntimeHandle,
  type ApprovalPort,
  type ApprovalRequestInput,
  type TurnRequestPorts,
  type TurnRequest,
  type TurnIntent,
  type TurnOutcome,
  type TurnAccessContext,
  type DeliveryOutcome,
  FileJournalStore,
  InteractionRouter,
  demoteScheduleCreator,
  type ScheduleActivityEvent,
  type ScheduleTurnExecutionRequest,
} from '@zhin.js/agent';
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
  createNativeWebToolFeatures,
  createNativeTodoToolFeatures,
  createNativeInteractionToolFeatures,
  FileTodoStore,
  AgentRuntime,
  type AgentCapabilities,
  type ToolCapability,
  turnIntentResolverToken,
  type TurnIntentResolver,
} from '@zhin.js/agent/runtime';

export { AgentRuntime, AgentTurnCoordinator } from '@zhin.js/agent/runtime';
export { InteractionRouter } from '@zhin.js/agent';

import type { AgentTool, JsonSchema } from '@zhin.js/ai';
import type {
  ConversationReference,
  ConversationResolution,
} from '@zhin.js/im-contract';

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

export interface InstallAgentHostOptions {
  /** Process-owned execution authority attached to exactly one Root. */
  readonly runtime: AgentRuntime;
  /** Root-owned authority shared by every Agent generation. */
  readonly interactions: InteractionRouter;
  /** @deprecated Prefer the generation-owned Primary Config. Test overrides only. */
  readonly ai?: AIConfig;
  /** @deprecated Prefer the generation-owned Primary Config. Test overrides only. */
  readonly assistant?: AssistantConfig;
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
  /** Optional host approval override; IM turns otherwise use createRuntimeApprovalPort. */
  readonly approvalPort?: ApprovalPort;
  /** Trusted product-policy seam for explicit steer/follow-up/observe intent and authorization. */
  readonly resolveTurnIntent?: TurnIntentResolver;
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
 * - Subagent/main-turn `bash` (sandbox + safety) + Owner `/approve` 命令面
 */
export function installAgentHost(options: InstallAgentHostOptions): RootResourceInstaller {
  return async ({ resources, lifecycle, handoff, config: primaryConfig, addFeature }) => {
    const configuredAi = options.ai ?? primaryConfig.get<AIConfig>('ai');
    const aiConfig = configuredAi;
    const assistantConfig = options.assistant
      ?? primaryConfig.get<AssistantConfig>('assistant');
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
        service,
        options.runtime,
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
          activateNext: async (signal) => {
            signal.throwIfAborted();
            try {
              const raw = database.getRawDatabase();
              if (!raw) {
                logger.warn(formatCompact({
                  op: 'agent_host_persistence',
                  mode: 'memory',
                  reason: 'database_not_started',
                }));
                return;
              }
              await activateAiDatabaseStorage(
                raw,
                { aiService: service, zhinAgent },
                aiConfig,
                orchService,
              );
              signal.throwIfAborted();
              logger.info(formatCompact({
                op: 'agent_host_persistence',
                mode: 'database',
                tables: tableCount,
              }));
            } catch (error) {
              logger.warn(formatCompact({
                op: 'agent_host_persistence',
                mode: 'memory',
                reason: 'activate_failed',
                error: error instanceof Error ? error.message : String(error),
              }));
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
      }
    } else {
      zhinAgent.markMemoryPersistenceReady();
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

    // extraTools (e.g. voice_stt / voice_tts) join the candidate ToolFeature.
    // Native builtin file tools are projected via createNativeFileToolFeatures
    // below — they are the SSOT and own the security context (workspaceRoot
    // + execPreset). bash stays a Tool projection here for back-compat with
    // subagent createRuntimeSubagentAgentTools consumers that read it as a Tool.
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
    for (const tool of createNativeWebToolFeatures()) {
      addFeature(tool.feature, tool.name, tool.definition);
    }
    for (const tool of createNativeTodoToolFeatures(
      new FileTodoStore(join(options.projectRoot, '.zhin', 'todos')),
    )) {
      addFeature(tool.feature, tool.name, tool.definition);
    }
    for (const tool of createNativeInteractionToolFeatures()) {
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
      protocol: Object.freeze({
        listBindings: () => Object.freeze(
          service.getBindingRegistry().listAgentNames()
            .map((name) => service.getBindingRegistry().getBinding(name))
            .filter((entry): entry is NonNullable<typeof entry> => entry != null)
            .map((entry) => Object.freeze({ ...entry, mcpServers: [...entry.mcpServers] })),
        ),
        execute: (bindingName: string, request: TurnRequest) => {
          const selected = service.getBindingRegistry().getBinding(bindingName);
          if (!selected) throw new Error(`Agent binding not found: ${bindingName}`);
          return options.runtime.execute(rootPluginId(), request, {
            binding: selected,
            mcpServers: selected.mcpServers,
            ...(selected.name === 'zhin' ? {} : { agent: selected.name }),
          });
        },
      }),
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
      const turnAccess = createRuntimeTurnAccess(message, senderRoles);
      const sessionKey = runtimeImSessionKey(turnAccess);

      // Runtime message.adapter is a CapabilityId (\0-separated); strip it and
      // use Endpoint liveName so the OutboundHost resolve() succeeds.
      const effectiveAdapter = capabilityLocalName(String(message.conversation.endpoint.id));
      const effectiveEndpoint = adapterLiveEndpointId(message);
      const reply = async (
        content: SendContent,
      ): Promise<Awaited<ReturnType<Message['$reply']>>> => {
        const receipt = await message.$reply(content);
        logger.debug(formatCompact({
          op: 'replychain_message_reply',
          status: receipt.status,
          code: receipt.failure?.code,
          messageId: receipt.message?.id,
        }));
        return receipt;
      };

      // 管理命令（原 MessageCommand /models /tree /reset…）— 在 AI trigger 前拦截
      const managementReply = await handleRuntimeManagementCommand({
        service,
        zhinAgent,
        sessionKey,
        content: message.content,
        senderRoles,
      });
      if (managementReply != null) {
        await reply(managementReply);
        logger.info(formatCompact({ op: 'agent_host_management', handled: true }));
        return true;
      }

      const approveReply = /^\/approve(?:\s|$)/iu.test(message.content.trim())
        ? handleRuntimeOwnerApproveCommand(
            {
              platform: turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : '',
              endpoint: turnAccess.origin.kind === 'im' ? turnAccess.origin.endpoint : '',
              ownerId,
              subjectId: turnAccess.principal.subjectId,
              scope: turnAccess.origin.kind === 'im' ? turnAccess.origin.scope : 'private',
            },
            message.content,
          )
        : null;
      if (approveReply != null) {
        await reply(approveReply);
        logger.info(formatCompact({ op: 'agent_host_approve', handled: true }));
        return true;
      }

      if (!matched) {
        // 群/频道旁听：未触发 AI 的共享会话消息写入会话背景（Passive Group Context）。
        await recordPassiveGroupContext(zhinAgent, turnAccess, message.content);
        return false;
      }

      if (isClearCommand(matched.content)) {
        await zhinAgent.archiveSession(sessionKey);
        await reply('已清空本会话的 AI 多轮上下文。');
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
        // thinkingMessage：进入 AI 处理前先回占位（对齐 legacy inbound-turn-pipeline）。
        // 占位消息不 await 回包——平台 ack 慢不应拖住 turn 启动；
        // 失败仅记日志（正式回复仍走 replyAndRecord 的完整确认）。
        if (trigger.thinkingMessage) {
          message.$reply(trigger.thinkingMessage).catch((error: unknown) => {
            logger.debug(formatCompact({
              op: 'agent_host_thinking_reply_failed',
              error: error instanceof Error ? error.message : String(error),
            }));
          });
        }

        const outcome = await withTriggerTimeout(
          async (signal) => {
            const request = createRuntimeTurnRequest(message, routed.userText, senderRoles, {
              traceId: randomUUID(),
              turnId: randomUUID(),
              signal,
              workspaceRoot: options.projectRoot,
              network: interactiveNetworkPolicy(service.getAgentConfig()),
              intent: await resolveProductTurnIntent(
                message,
                senderRoles,
                service.getAgentConfig()?.inboundQueue?.groupMode,
                resolveSnapshotTurnIntentResolver(snapshot, requester) ?? options.resolveTurnIntent,
              ),
              resolveReference: (reference, limits, referenceSignal) =>
                options.im.resolveConversationReference(lease, reference, {
                  signal: referenceSignal,
                  maxDepth: limits.depth,
                  maxEntries: limits.maxEntries,
                  maxChars: limits.maxChars,
                }),
              readConversationContext: async (consumer, contextSignal) => {
                contextSignal.throwIfAborted();
                if (!lease.active) throw new Error('Conversation context generation lease expired');
                return options.im.readConversationContext(message.conversation, consumer);
              },
              commitConversationContext: async (consumer, cursor) => {
                if (!lease.active) throw new Error('Conversation context generation lease expired');
                await options.im.commitConversationContext(message.conversation, consumer, cursor);
              },
              ports: {
                approval: options.approvalPort ?? createRuntimeApprovalPort({
                  isMaster: senderRoles.isMaster,
                  prompt: ownerId
                    ? options.im.createPrompt(message, { subjectId: ownerId })
                    : undefined,
                }),
                question: createRuntimeQuestionPort(options.interactions, message),
                reply: {
                  send: async (output) => {
                    logger.debug(formatCompact({
                      op: 'replychain_port_send',
                      outputElements: output.length,
                      outputPreview: flattenOutputElements(output).trim() || '(empty)',
                    }));
                    const content = await publishOutboundElements([...output], effectiveAdapter || undefined);
                    logger.debug(formatCompact({
                      op: 'replychain_publish_outbound',
                      segments: content.length,
                    }));
                    if (content.length === 0) return { status: 'suppressed' as const };
                    const outcome = deliveryOutcomeFromReceipt(
                      await reply(content),
                    );
                    logger.debug(formatCompact({
                      op: 'replychain_delivery_outcome',
                      status: outcome.status,
                      code: 'code' in outcome ? outcome.code : undefined,
                      messageId: 'messageId' in outcome ? outcome.messageId : undefined,
                    }));
                    return outcome;
                  },
                },
              },
            });
            return options.runtime.executeLeased(
              lease,
              requester,
              request,
              {
                binding,
                mcpServers: binding.mcpServers,
                agent: routed.agent?.qualifiedName ?? routed.agent?.name,
              },
            );
          },
          resolveTriggerTimeoutMs(trigger),
        );
        const elements = completedOutput(outcome);
        const outputText = flattenOutputElements(elements).trim();
        if (!outputText) {
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
          await reply(renderTriggerError(trigger, detail));
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
  service: AIService,
  runtime: AgentRuntime,
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
    turn: createRuntimeScheduleTurnPort(runtime, service, projectRoot),
    config: asPrivate(agent).config,
    activity: createScheduleActivityPort(agent),
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

function createRuntimeScheduleTurnPort(
  runtime: AgentRuntime,
  service: AIService,
  projectRoot: string,
) {
  return Object.freeze({
    execute: async (input: ScheduleTurnExecutionRequest): Promise<TurnOutcome> => {
      const binding = input.agent
        ? service.getBindingRegistry().getBinding(input.agent)
        : service.getBindingRegistry().requireZhinBinding();
      if (!binding) throw new Error(`Schedule Agent binding not found: ${input.agent}`);
      const creator = input.createdBy ? demoteScheduleCreator(input.createdBy) : undefined;
      const request: TurnRequest = {
        identity: { traceId: input.executionId, turnId: input.executionId },
        origin: { kind: 'schedule', jobId: input.jobId },
        intent: { kind: 'new' },
        principal: {
          subjectId: creator?.userId ?? 'schedule',
          ...(creator?.name ? { displayName: creator.name } : {}),
          roles: [...(creator?.roles ?? [])],
        },
        input: { text: input.prompt },
        session: { key: `schedule:${input.jobId}` },
        policy: {
          permissions: [],
          unattended: true,
          network: {
            enabled: true,
            httpsOnly: true,
            allowedDomains: [...input.security.allowedDomains],
          },
          shell: { preset: input.security.execPreset },
          filesystem: { workspaceRoot: projectRoot },
        },
        execution: {
          kind: 'schedule',
          executionPlan: input.executionPlan,
          createdBy: input.createdBy,
          security: {
            execPreset: input.security.execPreset,
            allowedDomains: [...input.security.allowedDomains],
          },
        },
        signal: input.signal,
        ports: {},
      };
      return runtime.execute(rootPluginId(), request, {
        binding,
        mcpServers: binding.mcpServers,
        ...(binding.name === 'zhin' ? {} : { agent: binding.name }),
      }, input.onTurnEvent);
    },
  });
}

function createScheduleActivityPort(agent: ZhinAgent) {
  return Object.freeze({
    publish: (event: ScheduleActivityEvent) => {
      const payload = scheduleActivityPayload(event);
      if (!payload) return;
      agent.getEventEmitter().emit(`schedule.${event.phase}`, payload);
    },
  });
}

function scheduleActivityPayload(event: ScheduleActivityEvent) {
  const previewIm = event.previewSource?.origin.kind === 'im' ? event.previewSource.origin : undefined;
  const notifyIm = event.notify.channel === 'im' ? event.notify.target.scene : undefined;
  const address = previewIm
    ? {
        platform: previewIm.platform,
        endpointKey: previewIm.endpoint,
        sceneId: previewIm.sceneId,
        scope: previewIm.scope,
        messageId: previewIm.messageId,
      }
    : notifyIm
      ? {
          platform: notifyIm.platform,
          endpointKey: notifyIm.endpointKey,
          sceneId: notifyIm.sceneId,
          scope: notifyIm.kind,
        }
      : undefined;
  if (!address) return undefined;
  return {
    sessionId: event.previewSource?.sessionKey ?? `schedule:${event.job.id}`,
    source: 'zhin-agent' as const,
    mode: 'text' as const,
    userId: event.job.createdBy?.userId ?? 'schedule',
    ...address,
    hookContext: {
      scheduleJobId: event.job.id,
      ...(event.job.createdBy ? { scheduleCreatedBy: event.job.createdBy } : {}),
      ...(event.previewSource ? { schedulePreview: true } : {}),
      scheduleActivityFeedback: true,
      ...(event.job.executionPlan ? { scheduleExecutionPlan: event.job.executionPlan } : {}),
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

/**
 * Subagent tool pool — derived from the same generation projection as the
 * main turn so the ToolIndex is the single source of truth. Native builtin
 * tools (file / web) are projected via the same helpers the main agent uses;
 * bash stays on the legacy Tool path until its native projection lands.
 */
function buildRuntimeSubagentAgentTools(_projectRoot: string): AgentTool[] {
  const nativeFiles = createNativeFileToolFeatures();
  const nativeWeb = createNativeWebToolFeatures();
  const bash = createBashTool();
  const fromNative: AgentTool[] = [...nativeFiles, ...nativeWeb].map((native) => ({
    name: native.name,
    description: native.definition.description,
    parameters: native.definition.inputSchema as JsonSchema,
    source: 'builtin',
    execute: (args: Record<string, unknown>, _ctx?: unknown, execCtx?: unknown) =>
      (native.definition.execute as (input: unknown, context: unknown) => Promise<unknown>)(
        args,
        execCtx,
      ),
  }));
  return [
    ...fromNative,
    {
      name: bash.name,
      description: bash.description,
      parameters: bash.parameters as JsonSchema,
      source: 'builtin',
      execute: bash.execute as (args: Record<string, unknown>) => Promise<unknown>,
    },
  ];
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

export interface RuntimeSenderRoles {
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
    network?: TurnRequest['policy']['network'];
    intent: TurnIntent;
    ports: TurnRequestPorts;
    resolveReference?: (
      reference: ConversationReference,
      options: Readonly<{ depth: number; maxEntries: number; maxChars: number }>,
      signal: AbortSignal,
    ) => Promise<ConversationResolution>;
    readConversationContext?: (consumer: string, signal: AbortSignal) => Promise<Readonly<{
      blocks: readonly import('@zhin.js/im-contract').ConversationContextBlock[];
      cursor: number;
    }>>;
    commitConversationContext?: (consumer: string, cursor: number) => Promise<void>;
  }>,
): TurnRequest {
  const access = createRuntimeTurnAccess(message, roles);
  const origin = access.origin;
  if (origin.kind !== 'im') throw new Error('Runtime IM ingress must produce an IM origin');
  const mediaEntries = collectSegmentMedia(
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
  const conversationReferences: ConversationReference[] = [];
  if (message.replyTo?.id) {
    conversationReferences.push(Object.freeze({
      kind: 'message',
      message: Object.freeze({ conversation: message.conversation, id: message.replyTo.id }),
    }));
  }
  for (const segment of toCanonicalSegments(message.segments ?? [])) {
    if (segment.type !== 'forward') continue;
    const forwardId = String(segment.data.forward_id ?? '').trim();
    if (!forwardId) continue;
    conversationReferences.push(Object.freeze({
      kind: 'forward',
      conversation: message.conversation,
      forwardId,
    }));
  }
  for (const entry of mediaEntries) {
    if (entry.source.kind !== 'platform_ref') continue;
    conversationReferences.push(Object.freeze({
      kind: 'media',
      conversation: message.conversation,
      media: Object.freeze({
        kind: 'file',
        value: entry.source.value,
        ...(entry.mimeType ? { mime_type: entry.mimeType } : {}),
        ...(entry.name ? { file_name: entry.name } : {}),
      }),
    }));
  }
  const turnReferences = conversationReferences.map((reference, index) => Object.freeze({
    key: `ref-${index + 1}`,
    kind: reference.kind,
    sourceId: reference.kind === 'message'
      ? reference.message.id
      : reference.kind === 'forward'
        ? reference.forwardId
        : reference.media.value,
  }));
  const referenceByKey = new Map<string, ConversationReference>(turnReferences.map((reference, index) => [
    reference.key,
    conversationReferences[index]!,
  ]));
  const media = mediaEntries.map((entry) => {
    if (entry.source.kind !== 'platform_ref') return entry;
    const reference = turnReferences.find((candidate) => candidate.kind === 'media' && candidate.sourceId === entry.source.value);
    return Object.freeze({ ...entry, ...(reference ? { referenceKey: reference.key } : {}) });
  });
  if (turnReferences.length > 0 && !input.resolveReference) {
    throw new TypeError('Runtime IM references require a generation-bound resolver');
  }
  const referencePort = turnReferences.length > 0
    ? Object.freeze({
        resolve: async (
          key: string,
          options: Readonly<{ depth: number; maxEntries: number; maxChars: number }>,
          signal: AbortSignal,
        ) => {
          const reference = referenceByKey.get(key);
          if (!reference) return Object.freeze({ status: 'forbidden' as const, code: 'reference_not_in_turn' });
          const result = await input.resolveReference!(reference, options, signal);
          if (result.status !== 'resolved') return result;
          return Object.freeze({ status: 'resolved' as const, content: result.value });
        },
      })
    : undefined;
  const contextConsumer = `agent:${access.principal.subjectId}`;
  const conversationContext = input.readConversationContext && input.commitConversationContext
    ? Object.freeze({
        readPending: (signal: AbortSignal) => input.readConversationContext!(contextConsumer, signal),
        commit: (cursor: number) => input.commitConversationContext!(contextConsumer, cursor),
      })
    : undefined;

  return Object.freeze({
    identity: Object.freeze({ traceId: input.traceId, turnId: input.turnId }),
    origin,
    principal: access.principal,
    intent: Object.freeze({ ...input.intent }),
    input: Object.freeze({
      text,
      ...(media.length > 0 ? { media: Object.freeze(media) } : {}),
      ...(turnReferences.length > 0 ? { references: Object.freeze(turnReferences) } : {}),
      metadata: Object.freeze({ ...message.metadata }),
    }),
    session: Object.freeze({
      key: runtimeImSessionKey(access),
    }),
    policy: Object.freeze({
      ...access.policy,
      filesystem: Object.freeze({ workspaceRoot: input.workspaceRoot }),
      ...(input.network ? { network: Object.freeze({
        enabled: input.network.enabled,
        httpsOnly: input.network.httpsOnly,
        allowedDomains: Object.freeze([...(input.network.allowedDomains ?? [])]),
      }) } : {}),
    }),
    signal: input.signal,
    ports: Object.freeze({
      ...input.ports,
      ...(referencePort ? { references: referencePort } : {}),
      ...(conversationContext ? { conversationContext } : {}),
    }),
  });
}

/**
 * Trusted adapter metadata may select an active-turn coordination intent.
 * Unknown/malformed values fail closed instead of silently becoming supersede.
 */
export function resolveRuntimeTurnIntent(
  message: Message,
  groupMode: 'supersede' | 'fifo' = 'supersede',
): TurnIntent {
  const raw = message.metadata?.turnIntent;
  if (raw === undefined) {
    return Object.freeze({
      kind: groupMode === 'fifo' && isGroupOrChannelRuntimeMessage(message) ? 'new' : 'supersede',
    });
  }
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('Runtime turnIntent metadata must be an object');
  }
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  if (!['new', 'steer', 'follow_up', 'supersede', 'observe'].includes(String(kind))) {
    throw new TypeError(`Runtime turnIntent kind is invalid: ${String(kind)}`);
  }
  const targetTurnId = record.targetTurnId;
  if (targetTurnId !== undefined && (typeof targetTurnId !== 'string' || !targetTurnId.trim())) {
    throw new TypeError('Runtime turnIntent targetTurnId must be a non-empty string');
  }
  const authorizedBy = record.authorizedBy;
  if (authorizedBy !== undefined) {
    throw new TypeError('Runtime turnIntent authorizedBy must be supplied by trusted product policy');
  }
  return Object.freeze({
    kind: kind as TurnIntent['kind'],
    ...(targetTurnId ? { targetTurnId } : {}),
  });
}

function isGroupOrChannelRuntimeMessage(message: Message): boolean {
  return message.conversation.kind === 'group' || message.conversation.kind === 'channel';
}

export function resolveSnapshotTurnIntentResolver(
  snapshot: Pick<RuntimeSnapshot, 'resources'>,
  requester: PluginId,
): TurnIntentResolver | undefined {
  const candidate = snapshot.resources.get(requester)?.get(turnIntentResolverToken.id);
  return typeof candidate === 'function' ? candidate as TurnIntentResolver : undefined;
}

export async function resolveProductTurnIntent(
  message: Message,
  senderRoles: Readonly<RuntimeSenderRoles>,
  groupMode: 'supersede' | 'fifo' | undefined,
  resolver: InstallAgentHostOptions['resolveTurnIntent'],
): Promise<TurnIntent> {
  const defaultIntent = resolveRuntimeTurnIntent(message, groupMode);
  if (!resolver) return defaultIntent;
  const resolved = await resolver(Object.freeze({ message, senderRoles, defaultIntent }));
  return Object.freeze({ ...resolved });
}

/** IM adapter for the origin-neutral interaction authority. */
export function createRuntimeQuestionPort(
  interactions: InteractionRouter,
  message: Message,
): NonNullable<TurnRequestPorts['question']> {
  const address = requireRuntimeInteractionAddress(message);
  return Object.freeze({
    ask: (request: Parameters<NonNullable<TurnRequestPorts['question']>['ask']>[0]) => (
      interactions.ask(address, request, (text) => deliverInteraction(message, text))
    ),
  });
}

/** IM ApprovalPort: master is already the authority; others wait for master via Prompt. */
export function createRuntimeApprovalPort(options: {
  readonly isMaster: boolean;
  readonly prompt?: CommandPrompt;
}): ApprovalPort {
  return Object.freeze({
    available: options.isMaster || options.prompt != null,
    async requestApproval(input: ApprovalRequestInput) {
      if (options.isMaster) return true;
      if (!options.prompt) return false;
      try {
        return await options.prompt.confirm(`请 master 确认：${input.question}`, {
          ...(input.timeoutMs !== undefined ? { timeout: input.timeoutMs } : {}),
          default: false,
          signal: input.signal,
        });
      } catch {
        return false;
      }
    },
  });
}

/** Consume an interaction reply before middleware, commands, or Agent fallback. */
export function consumeRuntimeInteraction(
  interactions: InteractionRouter,
  message: Message,
): Promise<boolean> {
  const address = runtimeInteractionAddress(message);
  if (!address) return Promise.resolve(false);
  return interactions.consume({
    ...address,
    text: message.content,
    deliver: (text) => deliverInteraction(message, text),
  });
}

function runtimeInteractionAddress(
  message: Message,
): Readonly<{ sessionKey: string; subjectId: string }> | undefined {
  const platform = capabilityLocalName(String(message.conversation.endpoint.id)).trim();
  const endpoint = message.endpointId?.trim();
  const subjectId = message.sender?.id?.trim();
  const sceneId = message.conversation.id.trim();
  if (!platform || !endpoint || !subjectId || !sceneId) return undefined;
  return Object.freeze({
    sessionKey: `${platform}:${endpoint}:${message.conversation.kind}:${sceneId}`,
    subjectId,
  });
}

function requireRuntimeInteractionAddress(
  message: Message,
): Readonly<{ sessionKey: string; subjectId: string }> {
  const address = runtimeInteractionAddress(message);
  if (!address) {
    throw new TypeError('Runtime interaction requires platform, endpoint, scene, and authenticated sender identity');
  }
  return address;
}

async function deliverInteraction(message: Message, text: string): Promise<void> {
  const receipt = await message.$reply(text);
  if (receipt.status !== 'sent') {
    throw new Error(`Interaction delivery failed: ${receipt.status}${receipt.failure ? ` (${receipt.failure.code})` : ''}`);
  }
}

export function deliveryOutcomeFromReceipt(
  receipt: Awaited<ReturnType<Message['$reply']>>,
): DeliveryOutcome {
  switch (receipt.status) {
    case 'sent':
      return {
        status: 'sent' as const,
        ...(receipt.message?.id
          ? { messageId: receipt.message.id }
          : {}),
      };
    case 'suppressed':
      return { status: 'suppressed' as const };
    case 'unsupported':
      return {
        status: 'unsupported' as const,
        code: receipt.failure?.code ?? 'outbound_unsupported',
      };
    case 'rejected':
      return {
        status: 'rejected' as const,
        code: receipt.failure?.code ?? 'outbound_payload_rejected',
      };
    case 'failed':
      return {
        status: 'failed' as const,
        code: receipt.failure?.code ?? 'endpoint_send_failed',
        retryable: receipt.failure?.retryable === true,
      };
  }
}

function interactiveNetworkPolicy(
  config: ReturnType<AIService['getAgentConfig']>,
): TurnRequest['policy']['network'] | undefined {
  return config?.execPreset === 'network'
    ? Object.freeze({ enabled: true, httpsOnly: true, allowedDomains: Object.freeze([]) })
    : undefined;
}

export function createRuntimeTurnAccess(
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

function runtimeImSessionKey(access: TurnAccessContext): string {
  const origin = access.origin;
  if (origin.kind !== 'im') throw new TypeError('Runtime IM access requires an IM origin');
  return `${origin.platform}:${origin.endpoint}:${origin.scope}:${origin.sceneId}`;
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

/**
 * 群/频道旁听（缺口 2，对齐 legacy register-group-session-passive）：
 * 未触发 AI 的共享会话消息写入 Passive Group Context，供后续 @ 时带入上下文。
 * 仅群/频道生效（私聊 / sandbox 不旁听，与 legacy dispatcher 适用范围一致）。
 */
export async function recordPassiveGroupContext(
  agent: Pick<ZhinAgent, 'recordPassiveGroupObservation'>,
  access: TurnAccessContext,
  content: string,
): Promise<void> {
  const origin = access.origin;
  if (origin.kind !== 'im' || (origin.scope !== 'group' && origin.scope !== 'channel')) return;
  const rawText = content.trim();
  if (!rawText) return;
  // 机器人自身消息不旁听（对齐 legacy isBotSelfMessage）。
  const senderId = access.principal.subjectId;
  const endpointKey = origin.endpoint;
  if (senderId !== '' && endpointKey !== '' && senderId === endpointKey) return;
  try {
    await agent.recordPassiveGroupObservation({
      sessionKey: runtimeImSessionKey(access),
      senderId,
      senderName: access.principal.displayName ?? senderId,
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
  const id = message.conversation.id.trim();
  if (!id) throw new TypeError('Runtime IM ingress requires scene identity');
  return id;
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
