import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  createSyntheticMessage,
  resolveSceneFieldsFromMessage,
  type AITriggerConfig,
  type Tool,
} from '@zhin.js/core';
import type { ImRuntime, Message, SendContent } from '@zhin.js/core/runtime';
import {
  expandEnvironmentValue,
  type ConfigDocumentPort,
  type RootResourceInstaller,
  type RuntimeConfigDocument,
} from '@zhin.js/runtime';
import { databaseHostToken, type PluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  AIService,
  McpClientManager,
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
  createDeferredMetaTools,
  activateAiDatabaseStorage,
  defineAiDatabaseModels,
  createScheduleJobStoreFromConfig,
  createScheduleTools,
  setScheduleManager,
  ScheduleJobEngine,
  JobWorker,
  createTaskExecutor,
  createNotificationRouter,
  resolveAssistantConfig,
  resolveAssistantDefaultsConfig,
  parseJobNotify,
  setAssistantRuntime,
  AssistantEventIngress,
  loadAssistantProfileFile,
  validateAssistantProfile,
  syncProfileHeartbeatToStore,
  syncProfileRoutinesToStore,
  pruneStaleProfileCronJobs,
  initOrchestrationService,
  MemoryOrchestrationRepository,
  registerDefaultExecutors,
  getAgentRuntimeRegistry,
  wireCollaborationStorage,
  applyRuntimeCollaborationInbound,
  findCellForInbound,
  getCollaborationSceneService,
  handleRuntimeOwnerApproveCommand,
  type ProactiveOutboundService,
  type AssistantConfig,
  type ImTranscriptWriteInput,
  type PeerTriggerMode,
} from '@zhin.js/agent';
import {
  CapabilityIngress,
  type AgentCapabilities,
  type ToolCapability,
} from '@zhin.js/agent/runtime';

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

const logger = getLogger('AgentHost');
const BOOTSTRAP_FILES = ['SOUL.md', 'AGENTS.md', 'TOOLS.md'] as const;
const MAX_BOOTSTRAP_CHARS = 12_000;

export async function resolveAiConfig(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<AIConfig | undefined> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return undefined;
  const ai = (document as Record<string, unknown>).ai;
  if (!ai || typeof ai !== 'object') return undefined;
  // Top-level `ai` bypasses Plugin ConfigView; expand + soft-prune like adapters.
  // `${VAR}` / `${VAR:-default}` expand from process.env; missing → "" (soft-fail).
  return softPruneAiConfig(expandEnvironmentValue(ai, (key) => process.env[key]) as AIConfig);
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
  readonly ai?: AIConfig;
  readonly assistant?: AssistantConfig;
  readonly collaboration?: unknown;
  readonly im: ImRuntime;
  readonly projectRoot: string;
  /**
   * Resolve Endpoint Owner id for `/approve` + bashAlways key.
   * Key: `localName` (e.g. icqq) or live endpoint name (uin).
   */
  readonly resolveEndpointOwner?: (adapterLocalName: string, endpointId: string) => string | undefined;
  /**
   * Resolve Endpoint trusted id 列表（plugins.<key>.trusted / endpoints[].trusted）。
   * 对齐 legacy resolveSenderRoles：trusted 角色弱于 master（不参与 Owner 审批放行）。
   */
  readonly resolveEndpointTrusted?: (adapterLocalName: string, endpointId: string) => readonly string[];
  /** Extra Host tools (e.g. Speech Host voice_stt / voice_tts). */
  readonly extraTools?: readonly AgentToolLike[];
  /** Optional inbound STT (Speech Host). */
  readonly transcribeUrl?: (audioUrl: string) => Promise<string | null>;
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
  return async ({ resources, lifecycle, handoff }) => {
    const config = options.ai;
    if (!config || typeof config !== 'object') return;

    let service: AIService;
    try {
      service = new AIService(config);
    } catch (error) {
      logger.warn(formatCompact({
        op: 'agent_host_skip',
        reason: 'invalid_ai_config',
        error: error instanceof Error ? error.message : String(error),
      }));
      return;
    }
    if (!service.isReady()) {
      logger.info(formatCompact({ op: 'agent_host_skip', reason: 'no_providers' }));
      return;
    }
    if (!service.getBindingRegistry().getBinding('zhin')) {
      logger.warn(formatCompact({
        op: 'agent_host_skip',
        reason: 'zhin_binding_unavailable',
        hint: 'ai.agents.zhin provider missing credentials after env expand',
        providers: service.listProviders().join(',') || '-',
      }));
      service.dispose();
      return;
    }

    let zhinAgent: ZhinAgent;
    let seedPresets: () => Promise<number>;
    let scheduleTools: Tool[] = [];
    let assistantEnabled = false;
    let collaborationReady = false;
    try {
      const created = createRuntimeZhinAgent(service, options.im, options.projectRoot);
      zhinAgent = created.agent;
      seedPresets = created.seedPresets;

      const orchService = initOrchestrationService(new MemoryOrchestrationRepository());
      registerDefaultExecutors(orchService, {
        refs: { zhinAgent, aiService: service },
      });
      getAgentRuntimeRegistry().registerDefault(zhinAgent);

      const schedule = wireRuntimeSchedule(
        zhinAgent,
        options.im,
        options.projectRoot,
        options.assistant,
      );
      scheduleTools = schedule.tools;
      assistantEnabled = schedule.assistantEnabled;
      lifecycle.add(schedule.dispose);
    } catch (error) {
      logger.warn(formatCompact({
        op: 'agent_host_skip',
        reason: 'zhin_agent_init_failed',
        error: error instanceof Error ? error.message : String(error),
      }));
      service.dispose();
      return;
    }

    const useDatabase = config.sessions?.useDatabase !== false;
    let persistencePendingActivate = false;
    if (useDatabase && resources.has(databaseHostToken)) {
      const database = resources.use(databaseHostToken);
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
                await wireCollaborationStorage(undefined, options.collaboration);
                collaborationReady = true;
                return;
              }
              await activateAiDatabaseStorage(
                raw,
                { aiService: service, zhinAgent },
                config,
                options.collaboration,
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
                await wireCollaborationStorage(undefined, options.collaboration);
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
        void wireCollaborationStorage(undefined, options.collaboration).then(() => {
          collaborationReady = true;
        });
      }
    } else {
      zhinAgent.markMemoryPersistenceReady();
      void wireCollaborationStorage(undefined, options.collaboration).then(() => {
        collaborationReady = true;
      });
    }

    const bashTool = createBashTool();
    const deferredMetaTools = createDeferredMetaTools({
      skillDirList: () => [join(options.projectRoot, 'skills')],
      skillMaxChars: 4_000,
    });

    const ingress = new CapabilityIngress();
    const mcp = new McpClientManager();
    const mcpEntries = parseMcpServers(config.mcpServers);
    let bootstrapText = '';
    let bootstrapLoaded = false;
    let mcpEnsured = false;

    // Dispose before any await so a cancelled generation cannot leak AIService.
    lifecycle.add(() => {
      void mcp.disconnectAll();
      zhinAgent.dispose();
      service.dispose();
    });

    const presetCount = await seedPresets();

    options.im.setUnmatchedHandler(async (message, snapshot, requester) => {
      const trigger = service.getTriggerConfig();
      const matched = matchAiTrigger(message, trigger);

      const ownerId = resolveOwnerForRuntimeMessage(message, options.resolveEndpointOwner);
      const endpointTrusted = resolveTrustedForRuntimeMessage(message, options.resolveEndpointTrusted);
      const senderRoles = resolveRuntimeSenderRoles(message, ownerId, endpointTrusted, trigger);
      const commMessage = bridgeRuntimeMessage(message, ownerId, senderRoles);

      // 入站流水 → im_transcripts（ADR 0009 D4；fire-and-forget，失败仅 debug）。
      recordRuntimeTranscript(zhinAgent, commMessage, {
        direction: 'inbound',
        body: message.content,
        messageId: message.id,
        senderId: message.sender ?? '',
        senderName: message.sender ?? '',
        senderRole: senderRoles.isMaster ? 'master' : senderRoles.isTrusted ? 'trusted' : 'user',
      });

      /** 回复并记录出站流水（assistant 角色，对齐 legacy message.send 收集）。 */
      const replyAndRecord = async (content: string) => {
        await message.$reply(content);
        recordRuntimeTranscript(zhinAgent, commMessage, {
          direction: 'outbound',
          body: content,
          senderRole: 'assistant',
        });
      };

      if (!matched) {
        // 群/频道旁听：未触发 AI 的共享会话消息写入会话背景（Passive Group Context）。
        void recordPassiveGroupContext(zhinAgent, message, commMessage);
        return false;
      }

      const approveReply = handleRuntimeOwnerApproveCommand(commMessage, matched.content);
      if (approveReply != null) {
        await replyAndRecord(approveReply);
        logger.info(formatCompact({ op: 'agent_host_approve', handled: true }));
        return true;
      }

      if (isClearCommand(matched.content)) {
        await zhinAgent.archiveSessionForCommMessage(commMessage);
        await replyAndRecord('已清空本会话的 AI 多轮上下文。');
        return true;
      }

      try {
        if (!bootstrapLoaded) {
          bootstrapText = await loadBootstrap(options.projectRoot);
          bootstrapLoaded = true;
        }
        if (!mcpEnsured) {
          // Only latch when every configured server connected; a partial
          // failure must be retried on the next inbound turn.
          mcpEnsured = await ensureMcpConnections(mcp, mcpEntries);
        }
        const inbound = await preprocessInboundTurn(
          matched.content,
          message.metadata,
          options.transcribeUrl,
        );
        const capabilities = readCapabilities(ingress, snapshot, requester);
        const routed = routeSpecialistAgent(inbound.text, capabilities);
        const binding = service.getBindingRegistry().requireZhinBinding();
        zhinAgent.configure({
          activeBinding: binding,
          bootstrapContext: buildBootstrapContext(bootstrapText, capabilities, routed.agent),
        });

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
        if (collab.action === 'skip') {
          logger.debug(formatCompact({
            op: 'agent_host_collab_skip',
            reason: collab.reason,
          }));
          return true;
        }
        if (collab.action === 'done') {
          logger.debug(formatCompact({
            op: 'agent_host_collab_done',
            reason: collab.reason,
          }));
          return true;
        }

        const tools = [
          ...capabilities.tools.map(toTool),
          ...await mcpToolsAsTools(capabilities),
          ...configMcpToolsAsTools(mcp),
          ...(options.extraTools ?? []).map(toTool),
          // discover / load_tool / load_skill — always-on deferred meta (ADR 0029).
          // spawn_task is injected by ToolSystem when SubagentSystem is attached.
          ...deferredMetaTools,
          ...scheduleTools,
          bashTool,
        ];

        // thinkingMessage：进入 AI 处理前先回占位（对齐 legacy inbound-turn-pipeline）。
        if (trigger.thinkingMessage) {
          await replyAndRecord(trigger.thinkingMessage);
        }

        zhinAgent.initInboundTurnContext();
        const elements = await withTriggerTimeout(
          zhinAgent.process(routed.userText, commMessage, tools),
          resolveTriggerTimeoutMs(trigger),
        );
        const text = flattenOutputElements(elements).trim() || '(empty AI response)';
        await replyAndRecord(text);
        logger.debug(formatCompact({
          op: 'agent_host_turn',
          turnMode: 'zhin_agent.process',
          tools: tools.length,
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
      }
    });

    const binding = service.getBindingRegistry().requireZhinBinding();
    logger.info(formatCompact({
      op: 'agent_host_ready',
      turnMode: 'zhin_agent.process',
      subagent: zhinAgent.getSubagentSystem() ? 'on' : 'off',
      presets: presetCount,
      binding: `${binding.name}@${binding.providerAlias}/${binding.model}`,
      providers: service.listProviders().join(','),
      mcpServers: mcpEntries.map((entry) => entry.name).join(',') || '-',
      extraTools: (options.extraTools ?? []).map((tool) => tool.name).join(',') || '-',
      inboundStt: options.transcribeUrl ? 'on' : 'off',
      persistence: persistencePendingActivate ? 'pending_activate' : 'memory',
      schedule: scheduleTools.length > 0 ? 'on' : 'off',
      assistant: assistantEnabled ? 'on' : 'off',
      collaboration: collaborationReady || persistencePendingActivate ? 'on' : 'pending',
      bash: 'on',
      approve: options.resolveEndpointOwner ? 'on' : 'partial',
    }));
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
  assistantRaw?: AssistantConfig,
): { tools: Tool[]; dispose: () => void; assistantEnabled: boolean } {
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

  const proactiveOutbound = createRuntimeProactiveOutbound(im);
  const notificationRouter = createNotificationRouter({
    resolveAdapter: () => undefined,
    sendIm: async (notify, content) => {
      await proactiveOutbound.send({
        scene: notify.target.scene,
        source: 'scheduled',
      }, content);
    },
  });
  const executor = createTaskExecutor({
    agent,
    resolveAdapter: () => undefined,
    router: notificationRouter,
    defaultNotify,
    proactiveOutbound,
    deliverIm: async (notify, content) => {
      await proactiveOutbound.send({
        scene: notify.target.scene,
        source: 'scheduled',
      }, content);
    },
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

  setScheduleManager({
    scheduleFeature: {
      getStatus: () => [],
    },
    engine: jobEngine,
    previewTask: (opts) => executor.executeTask({
      ...opts,
      preview: true,
      timeContext: false,
    }),
  });

  if (assistantCfg.enabled) {
    const ingress = new AssistantEventIngress({
      store,
      engine: jobEngine,
      eventsConfig: assistantCfg.events,
    });
    setAssistantRuntime({
      config: assistantCfg,
      store,
      engine: jobEngine,
      ingress,
    });
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
    setAssistantRuntime(null);
    jobEngine.load();
  }

  const tools = createScheduleTools().map((tool) => {
    const plain = tool.toTool();
    return {
      name: plain.name,
      description: plain.description,
      parameters: plain.parameters as Tool['parameters'],
      source: 'builtin',
      execute: plain.execute as Tool['execute'],
      tags: plain.tags,
      keywords: plain.keywords,
    } satisfies Tool;
  });

  return {
    tools,
    assistantEnabled: assistantCfg.enabled,
    dispose: () => {
      setScheduleManager(null);
      setAssistantRuntime(null);
      jobEngine.unload();
      jobWorker.stop();
    },
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
): { agent: ZhinAgent; seedPresets: () => Promise<number> } {
  const binding = service.getBindingRegistry().requireZhinBinding();
  const provider = service.getProvider(binding.providerAlias);
  const agent = new ZhinAgent(provider, {
    ...(service.getAgentConfig() ?? {}),
    chatModel: binding.model,
  });
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
      const previousCwd = process.cwd();
      try {
        if (previousCwd !== projectRoot) process.chdir(projectRoot);
        const metas = await discoverWorkspaceAgents(null);
        return metas.find((meta) => meta.name === name) ?? null;
      } finally {
        if (process.cwd() !== previousCwd) process.chdir(previousCwd);
      }
    },
    getParentContextSnapshot: (origin) => agent.buildParentContextSnapshotForSubagent(origin),
  });

  // Persistence readiness is latched after DatabaseHost activateNext (or
  // immediately when sessions.useDatabase === false / no DatabaseHost).
  return {
    agent,
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
    ...createDeferredMetaTools({
      skillDirList: () => [join(projectRoot, 'skills')],
      skillMaxChars: 4_000,
    }),
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
  const previousCwd = process.cwd();
  try {
    if (previousCwd !== projectRoot) process.chdir(projectRoot);
    const metas = await discoverWorkspaceAgents(null);
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
  } finally {
    if (process.cwd() !== previousCwd) process.chdir(previousCwd);
  }
}

function createRuntimeProactiveOutbound(im: ImRuntime): ProactiveOutboundService {
  return {
    async send(ctx, content) {
      const text = sendContentToText(content);
      const result = await im.sendEndpointMessage({
        adapter: ctx.scene.platform,
        endpointId: ctx.scene.endpointId,
        channelType: ctx.scene.kind,
        channelId: ctx.scene.sceneId,
        content: text,
      });
      return result.messageId || 'ok';
    },
    async sendElements(ctx, elements) {
      const text = flattenOutputElements(elements);
      if (!text.trim()) return [];
      const id = await this.send(ctx, text);
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
  const senderId = String(message.sender ?? '');
  const triggerMasters = (trigger?.masters ?? []).map(String);
  const triggerTrusted = (trigger?.trusted ?? []).map(String);
  const isMaster = senderId !== ''
    && ((endpointMaster != null && senderId === String(endpointMaster))
      || triggerMasters.includes(senderId));
  const isTrusted = !isMaster && senderId !== ''
    && (triggerTrusted.includes(senderId) || endpointTrusted.map(String).includes(senderId));
  return { isMaster, isTrusted };
}

export function bridgeRuntimeMessage(
  message: Message,
  endpointMaster: string | undefined,
  roles: RuntimeSenderRoles,
) {
  const localName = capabilityLocalName(message.adapter);
  const channelType = resolveChannelType(message.metadata);
  const channelId = resolveChannelId(message);
  // Prefer real Endpoint name (e.g. ICQQ uin); fall back to adapter local name.
  const endpointId = String(
    message.metadata?.endpoint
    ?? message.metadata?.endpointId
    ?? localName,
  );
  const senderId = message.sender ?? 'anon';
  const quoteId = message.metadata?.quote_id;
  return createSyntheticMessage({
    adapter: localName,
    endpoint: endpointId,
    id: message.id,
    ...(typeof quoteId === 'string' && quoteId ? { quote_id: quoteId } : {}),
    sender: {
      id: senderId,
      name: message.sender,
      isMaster: roles.isMaster,
      isTrusted: roles.isTrusted,
    },
    channel: {
      type: channelType,
      id: channelId,
    },
    reply: async (content) => {
      await message.$reply(sendContentToText(content) as SendContent);
      return message.id ?? 'ok';
    },
    extra: {
      ...message.metadata,
      runtimeAdapter: message.adapter,
      runtimeTarget: message.target,
      ...(endpointMaster ? { endpointMaster } : {}),
    },
  });
}

function resolveOwnerForRuntimeMessage(
  message: Message,
  resolve?: InstallAgentHostOptions['resolveEndpointOwner'],
): string | undefined {
  if (!resolve) return undefined;
  const localName = capabilityLocalName(message.adapter);
  const endpointId = String(
    message.metadata?.endpoint
    ?? message.metadata?.endpointId
    ?? localName,
  );
  return resolve(localName, endpointId) ?? resolve(endpointId, endpointId);
}

function resolveTrustedForRuntimeMessage(
  message: Message,
  resolve?: InstallAgentHostOptions['resolveEndpointTrusted'],
): readonly string[] {
  if (!resolve) return [];
  const localName = capabilityLocalName(message.adapter);
  const endpointId = String(
    message.metadata?.endpoint
    ?? message.metadata?.endpointId
    ?? localName,
  );
  const merged = [...resolve(localName, endpointId), ...resolve(endpointId, endpointId)];
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
 * （buildImTranscriptQuery）保持同一 SSOT；fire-and-forget，失败仅 debug。
 */
export function recordRuntimeTranscript(
  agent: Pick<ZhinAgent, 'recordImTranscript'>,
  commMessage: ReturnType<typeof createSyntheticMessage>,
  draft: RuntimeTranscriptDraft,
): void {
  const body = draft.body ?? '';
  if (!body.trim()) return;
  const scene = resolveSceneFieldsFromMessage(commMessage);
  const input: ImTranscriptWriteInput = {
    message_id: draft.messageId ?? '',
    platform: scene.platform,
    endpoint_id: scene.endpointId,
    scene_id: scene.sceneId,
    scene_type: scene.sceneType,
    sender_id: draft.senderId ?? scene.endpointId,
    sender_name: draft.senderName ?? scene.endpointId,
    sender_role: draft.senderRole ?? 'user',
    direction: draft.direction,
    body,
    time: Date.now(),
  };
  void agent.recordImTranscript(input).catch((error) => {
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
  agent: Pick<ZhinAgent, 'recordPassiveGroupMessage'>,
  message: Message,
  commMessage: ReturnType<typeof createSyntheticMessage>,
): Promise<void> {
  const channelType = resolveChannelType(message.metadata);
  if (channelType !== 'group' && channelType !== 'channel') return;
  const rawText = message.content.trim();
  if (!rawText) return;
  // 机器人自身消息不旁听（对齐 legacy isBotSelfMessage）。
  const senderId = String(message.sender ?? '');
  const endpointId = String(commMessage.$endpoint ?? '');
  if (senderId !== '' && endpointId !== '' && senderId === endpointId) return;
  try {
    const sceneService = getCollaborationSceneService();
    let cell = findCellForInbound(
      sceneService.listScenes(),
      String(commMessage.$adapter),
      String(commMessage.$channel?.id ?? ''),
      endpointId,
    );
    if (cell) {
      cell = (await sceneService.getSceneFresh(cell.id)) ?? cell;
    }
    await agent.recordPassiveGroupMessage(commMessage, rawText, cell);
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

/**
 * ai.trigger.timeout 包装：超时即 reject（不取消底层 generation）。
 * promise 立即挂 then/catch，超时后迟到的 settle 不会成为 unhandledRejection。
 */
export function withTriggerTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`AI 处理超时（${timeoutMs}ms）`));
    }, timeoutMs);
    promise.then(
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
  const raw = String(
    message.metadata?.channelId
    ?? message.metadata?.sceneId
    ?? message.target
    ?? '',
  );
  // Strip scene prefix so AF / session sceneId stay as bare ids (private:uid → uid).
  const stripped = raw.replace(/^(private|group|channel|direct|c2c):/iu, '');
  return stripped || raw || (message.sender ?? 'unknown');
}

function capabilityLocalName(id: string): string {
  const parts = id.split('\0');
  return parts.length >= 3 ? parts[2]! : id;
}

function resolveChannelType(
  metadata: Readonly<Record<string, unknown>>,
): 'private' | 'group' | 'channel' {
  const raw = String(metadata.type ?? metadata.channelType ?? 'private');
  if (raw === 'group' || raw === 'channel' || raw === 'private') return raw;
  if (raw === 'direct' || raw === 'c2c') return 'private';
  if (raw === 'guild') return 'channel';
  return 'private';
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

function readCapabilities(
  ingress: CapabilityIngress,
  snapshot: RuntimeSnapshot,
  requester: PluginId,
): AgentCapabilities {
  try {
    return ingress.read(snapshot, requester);
  } catch {
    return Object.freeze({
      generation: snapshot.generation,
      owner: requester,
      tools: Object.freeze([]),
      skills: Object.freeze([]),
      agents: Object.freeze([]),
      mcp: Object.freeze([]),
    });
  }
}

function toTool(tool: AgentToolLike | ToolCapability): Tool {
  const parameters = isToolCapability(tool)
    ? parametersFromInputSchema(tool.inputSchema)
    : tool.parameters;
  const source = isToolCapability(tool) ? tool.owner : tool.source;
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: (parameters.properties ?? {}) as Tool['parameters']['properties'],
      required: parameters.required,
    },
    source,
    async execute(args) {
      return await tool.execute(args as Record<string, unknown>) as Awaited<ReturnType<Tool['execute']>>;
    },
  };
}

function isToolCapability(tool: AgentToolLike | ToolCapability): tool is ToolCapability {
  return 'inputSchema' in tool && 'owner' in tool;
}

async function mcpToolsAsTools(capabilities: AgentCapabilities): Promise<Tool[]> {
  const tools: Tool[] = [];
  for (const connection of capabilities.mcp) {
    let listed: readonly {
      readonly name: string;
      readonly description?: string;
      readonly inputSchema?: unknown;
    }[];
    try {
      listed = await connection.listTools();
    } catch (error) {
      logger.debug(formatCompact({
        op: 'agent_host_mcp_list_fail',
        name: connection.name,
        error: error instanceof Error ? error.message : String(error),
      }));
      continue;
    }
    for (const tool of listed) {
      const qualified = `${connection.name}__${tool.name}`;
      const parameters = parametersFromInputSchema(tool.inputSchema);
      tools.push({
        name: qualified,
        description: tool.description ?? `MCP ${connection.name}/${tool.name}`,
        parameters: {
          type: 'object',
          properties: (parameters.properties ?? {}) as Tool['parameters']['properties'],
          required: parameters.required,
        },
        source: `mcp:${connection.name}`,
        async execute(args) {
          return await connection.callTool(tool.name, args as Record<string, unknown>) as Awaited<ReturnType<Tool['execute']>>;
        },
      });
    }
  }
  return tools;
}

function configMcpToolsAsTools(mcp: McpClientManager): Tool[] {
  return mcp.getAllTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as Tool['parameters'],
    source: tool.source,
    execute: async (args) =>
      await tool.execute(args as Record<string, unknown>) as Awaited<ReturnType<Tool['execute']>>,
  }));
}

async function ensureMcpConnections(
  mcp: McpClientManager,
  entries: readonly McpServerEntry[],
): Promise<boolean> {
  for (const entry of entries) {
    if (mcp.isConnected(entry.name)) continue;
    try {
      await mcp.connect(entry);
      logger.info(formatCompact({ op: 'agent_host_mcp_connected', name: entry.name }));
    } catch (error) {
      logger.warn(formatCompact({
        op: 'agent_host_mcp_connect_fail',
        name: entry.name,
        transport: entry.transport,
        url: entry.url ?? entry.command ?? '-',
        error: error instanceof Error ? error.message : String(error),
        hint: entry.transport === 'streamable-http' || entry.transport === 'sse'
          ? 'check MCP URL/token and that the server is listening'
          : 'check MCP command/args and process env',
      }));
    }
  }
  return entries.every((entry) => mcp.isConnected(entry.name));
}

function parseMcpServers(raw: AIConfig['mcpServers']): McpServerEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: McpServerEntry[] = [];
  for (const item of raw) {
    const entry = toMcpServerEntry(item);
    if (entry) out.push(entry);
  }
  return out;
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

/**
 * Drop providers that cannot form an SDK adapter (empty credentials after expand),
 * and drop agent bindings whose provider was removed.
 */
function softPruneAiConfig(ai: AIConfig): AIConfig {
  const providers = ai.providers ?? {};
  const keptProviders: NonNullable<AIConfig['providers']> = {};
  for (const [alias, cfg] of Object.entries(providers)) {
    if (isUsableProvider(cfg as unknown as Record<string, unknown>)) {
      keptProviders[alias] = cfg;
    } else {
      logger.debug(formatCompact({ op: 'agent_host_provider_skip', alias, reason: 'missing_credentials' }));
    }
  }

  const agents = ai.agents ?? {};
  const keptAgents: NonNullable<AIConfig['agents']> = {};
  for (const [name, binding] of Object.entries(agents)) {
    if (keptProviders[binding.provider]) {
      keptAgents[name] = binding;
    } else {
      const level = name === 'zhin' ? 'warn' : 'debug';
      logger[level](formatCompact({
        op: 'agent_host_agent_skip',
        name,
        provider: binding.provider,
        reason: 'provider_unavailable',
      }));
    }
  }

  const mcpServers = Array.isArray(ai.mcpServers)
    ? ai.mcpServers.filter((entry) => toMcpServerEntry(entry) != null)
    : ai.mcpServers;

  return {
    ...ai,
    providers: keptProviders,
    agents: keptAgents,
    mcpServers,
  };
}

function isUsableProvider(cfg: Record<string, unknown>): boolean {
  const sdk = typeof cfg.sdk === 'string' ? cfg.sdk.trim().toLowerCase() : '';
  const apiKey = typeof cfg.apiKey === 'string' ? cfg.apiKey.trim() : '';
  const baseUrl = typeof cfg.baseUrl === 'string' ? cfg.baseUrl.trim() : '';
  const host = typeof cfg.host === 'string' ? cfg.host.trim() : '';
  const accountId = typeof cfg.accountId === 'string' ? cfg.accountId.trim() : '';

  if (sdk === 'ollama') return Boolean(host || baseUrl);
  if (sdk === 'openai-compatible' || (!sdk && (baseUrl || accountId))) {
    if (accountId) return Boolean(apiKey || accountId);
    return Boolean(baseUrl && apiKey);
  }
  // sdk filled by normalize later (alias presets); require apiKey or ollama host
  if (!sdk) {
    if (host) return true;
    return Boolean(apiKey && (baseUrl || true));
  }
  return Boolean(apiKey);
}

function buildBootstrapContext(
  bootstrap: string,
  capabilities: AgentCapabilities,
  activeAgent?: AgentCapabilities['agents'][number],
): string {
  const parts: string[] = [];
  if (bootstrap) parts.push(bootstrap);

  if (activeAgent) {
    parts.push(`## Active specialist: ${activeAgent.name}`);
    parts.push(activeAgent.description);
    if (activeAgent.instructions) parts.push(activeAgent.instructions);
  } else if (capabilities.agents.length > 0) {
    parts.push('Available specialist agents (prefix user text with `@name` to route):');
    for (const agent of capabilities.agents) {
      const excerpt = truncate(agent.instructions, 400);
      parts.push(`### ${agent.name}\n${agent.description}\n${excerpt}`);
    }
  }

  if (capabilities.skills.length > 0) {
    parts.push('Available skills:');
    for (const skill of capabilities.skills) {
      parts.push(`- ${skill.name}: ${skill.description}`);
    }
  }

  return parts.join('\n\n');
}

async function preprocessInboundTurn(
  content: string,
  metadata: Readonly<Record<string, unknown>> | undefined,
  transcribeUrl?: (audioUrl: string) => Promise<string | null>,
): Promise<{ readonly text: string; readonly sttApplied: boolean }> {
  const audioUrl = resolveInboundAudioUrl(content, metadata);
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
  content: string,
  metadata: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const fromMeta = metadata?.audio_url;
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();
  const match = content.match(/\[audio:([^\]]+)\]/u);
  const fromContent = match?.[1]?.trim();
  return fromContent || undefined;
}

function stripAudioPlaceholders(content: string): string {
  return content.replace(/\[audio:[^\]]*\]/gu, '').trim();
}

function routeSpecialistAgent(
  userText: string,
  capabilities: AgentCapabilities,
): {
  readonly userText: string;
  readonly agent?: AgentCapabilities['agents'][number];
} {
  const match = userText.match(/^@([^\s:：]+)[:：]?\s*/u);
  if (!match) return { userText };
  const name = match[1]!.toLowerCase();
  const agent = capabilities.agents.find((item) => item.name.toLowerCase() === name);
  if (!agent) return { userText };
  return {
    userText: userText.slice(match[0].length).trim() || userText,
    agent,
  };
}

function parametersFromInputSchema(schema: unknown): AgentToolLike['parameters'] {
  if (isJsonSchemaObject(schema)) {
    return {
      type: 'object',
      properties: schema.properties ?? {},
      required: schema.required,
    };
  }
  return zodLikeToParameters(schema);
}

function isJsonSchemaObject(value: unknown): value is {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
} {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as { type?: unknown }).type === 'object';
}

function zodLikeToParameters(schema: unknown): AgentToolLike['parameters'] {
  const result: AgentToolLike['parameters'] = {
    type: 'object',
    properties: {},
    required: [],
  };
  const shape = (schema as { shape?: Record<string, unknown> } | null)?.shape;
  if (!shape) return result;
  const required: string[] = [];
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(shape)) {
    properties[key] = zodFieldToJsonSchema(value);
    const typeName = (value as { _def?: { typeName?: string } })?._def?.typeName;
    if (typeName !== 'ZodOptional' && typeName !== 'ZodDefault') required.push(key);
  }
  return { type: 'object', properties, required };
}

function zodFieldToJsonSchema(z: unknown): Record<string, unknown> {
  const zod = z as {
    _def?: {
      typeName?: string;
      innerType?: unknown;
      type?: unknown;
      element?: unknown;
      description?: string;
      values?: string[];
    };
  };
  if (!zod?._def) return { type: 'string' };
  const def = zod._def;
  const typeName = def.typeName;
  if (typeName === 'ZodOptional' || typeName === 'ZodDefault') {
    return zodFieldToJsonSchema(def.innerType ?? def.type);
  }
  if (typeName === 'ZodString') {
    return def.description ? { type: 'string', description: def.description } : { type: 'string' };
  }
  if (typeName === 'ZodNumber') {
    return def.description ? { type: 'number', description: def.description } : { type: 'number' };
  }
  if (typeName === 'ZodBoolean') {
    return def.description ? { type: 'boolean', description: def.description } : { type: 'boolean' };
  }
  if (typeName === 'ZodEnum') return { type: 'string', enum: def.values };
  if (typeName === 'ZodArray') {
    return { type: 'array', items: zodFieldToJsonSchema(def.type ?? def.element) };
  }
  return { type: 'string' };
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
  if (respondToAt && !isPrivate && message.metadata?.mentioned === true) {
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
  const channelType = String(
    message.metadata?.type
    ?? message.metadata?.channelType
    ?? '',
  );
  if (channelType === 'private' || channelType === 'direct' || channelType === 'c2c') {
    return true;
  }
  // Fallback: target often looks like `private:<id>` when metadata is sparse.
  const target = String(message.target ?? '');
  return /^(private|direct|c2c):/iu.test(target);
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
