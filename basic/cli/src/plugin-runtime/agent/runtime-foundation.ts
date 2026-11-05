import { randomUUID } from 'node:crypto';
import type { ExecutionBinding } from '@zhin.js/ai/provider';
import type { ModelRuntimeServiceOptions, ModelExecutionScope } from '@zhin.js/agent/model-runtime';
import { getAgentTurnConfiguration, runWithAgentTurnConfiguration } from '@zhin.js/agent/turn';
import { projectLocaleToken, resolveLocale } from '@zhin.js/plugin-runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { ImRuntime } from '@zhin.js/core/runtime';
import {
  AIService,
  type LocalImageAssetStore,
  ApprovalReviewAgent,
  createAutoApprovalPort,
  createBypassApprovalPort,
  type ApprovalPort,
  type AssistantConfig,
  type AudioTranscriptionPort,
} from '@zhin.js/agent';
import { LlmApprovalJudgment, type ApprovalJudgmentPort } from '@zhin.js/agent/session';
import {
  type AgentRuntime,
  MarkdownKnowledgeIndex,
  SemanticMemoryRuntime,
  agentEventBusToken,
  aiCompletionToken,
  createAiCompletion,
  createAgentTraceRuntime,
  createSessionTreeRuntimeFromAgent,
} from '@zhin.js/agent/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import {
  resolveAgentHostKnowledgeDirectory,
  type AgentHostAIConfig,
} from './config.js';
import { createRuntimeZhinAgent } from './runtime-factory.js';
import {
  createAssistantHomeRuntime,
  createAssistantScheduleRuntime,
} from './assistant-runtime.js';

type RootResourceContext = Parameters<RootResourceInstaller>[0];
type RuntimeZhinAgent = ReturnType<typeof createRuntimeZhinAgent>;
type AssistantHomeRuntime = Awaited<ReturnType<typeof createAssistantHomeRuntime>>;

export interface AgentRuntimeFoundationOptions {
  readonly modelRuntime: ModelRuntimeServiceOptions;
  readonly acquireDeploymentModels: (input: Readonly<{ service: AIService; bindingName?: string; sessionKey?: string; operationId?: string; lease?: import('@zhin.js/plugin-runtime').SnapshotLease; signal?: AbortSignal }>) => Promise<ModelExecutionScope>;
  readonly config: AgentHostAIConfig;
  readonly assistantConfig?: AssistantConfig;
  readonly im: ImRuntime;
  readonly projectRoot: string;
  readonly localAssets?: LocalImageAssetStore;
  readonly processRuntime: AgentRuntime;
  readonly approvalPort?: ApprovalPort;
  readonly audioTranscriber?: AudioTranscriptionPort;
  readonly resources: RootResourceContext['resources'];
  readonly lifecycle: RootResourceContext['lifecycle'];
}

export interface FoundationModelOperation {
  readonly lease: import('@zhin.js/plugin-runtime').SnapshotLease;
  readonly bindingName: string;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly signal: AbortSignal;
}
export interface FoundationModelSelection {
  readonly lease: import('@zhin.js/plugin-runtime').SnapshotLease;
  readonly snapshots: import('@zhin.js/plugin-runtime').SnapshotReader;
  readonly bindingName: string;
  readonly signal: AbortSignal;
}
type WithModelSelection = <T>(input: FoundationModelSelection, run: (binding: ExecutionBinding) => Promise<T>) => Promise<T>;
type WithFoundationModels = <T>(input: FoundationModelOperation, run: (models: ModelExecutionScope) => Promise<T>) => Promise<T>;
interface AgentRuntimeFoundationState {
  readonly withModels: WithFoundationModels;
  readonly withModelSelection: WithModelSelection;
  readonly service: AIService;
  readonly agent: RuntimeZhinAgent['agent'];
  readonly composition: RuntimeZhinAgent['runtime'];
  readonly knowledgeIndex?: MarkdownKnowledgeIndex;
  readonly semanticMemory: SemanticMemoryRuntime | null;
  readonly traceRuntime: ReturnType<typeof createAgentTraceRuntime>;
  readonly schedule: ReturnType<typeof createAssistantScheduleRuntime>;
  readonly home: AssistantHomeRuntime;
  readonly sessionTreeRuntime: ReturnType<typeof createSessionTreeRuntimeFromAgent>;
  readonly approvalReviewer: ApprovalReviewAgent;
  readonly approvalJudgment: ApprovalJudgmentPort;
  readonly bypassApprovalPort: ApprovalPort;
}

/** A complete, validated Agent runtime candidate with all owned auxiliaries. */
export class AgentRuntimeFoundation {
  readonly withModels: WithFoundationModels;
  readonly withModelSelection: WithModelSelection;
  readonly service: AIService;
  readonly agent: RuntimeZhinAgent['agent'];
  readonly composition: RuntimeZhinAgent['runtime'];
  readonly knowledgeIndex: MarkdownKnowledgeIndex | undefined;
  readonly semanticMemory: SemanticMemoryRuntime | null;
  readonly traceRuntime: ReturnType<typeof createAgentTraceRuntime>;
  readonly schedule: ReturnType<typeof createAssistantScheduleRuntime>;
  readonly scheduleTools: ReturnType<typeof createAssistantScheduleRuntime>['tools'];
  readonly homeTools: AssistantHomeRuntime['tools'];
  readonly assistantEnabled: boolean;
  readonly sessionTreeRuntime: ReturnType<typeof createSessionTreeRuntimeFromAgent>;
  readonly approvalReviewer: ApprovalReviewAgent;
  readonly approvalJudgment: ApprovalJudgmentPort;
  readonly bypassApprovalPort: ApprovalPort;

  private constructor(state: AgentRuntimeFoundationState) {
    this.withModels = state.withModels;
    this.withModelSelection = state.withModelSelection;
    this.service = state.service;
    this.agent = state.agent;
    this.composition = state.composition;
    this.knowledgeIndex = state.knowledgeIndex;
    this.semanticMemory = state.semanticMemory;
    this.traceRuntime = state.traceRuntime;
    this.schedule = state.schedule;
    this.scheduleTools = state.schedule.tools;
    this.homeTools = state.home.tools;
    this.assistantEnabled = state.schedule.assistantEnabled;
    this.sessionTreeRuntime = state.sessionTreeRuntime;
    this.approvalReviewer = state.approvalReviewer;
    this.approvalJudgment = state.approvalJudgment;
    this.bypassApprovalPort = state.bypassApprovalPort;
  }

  static async create(options: AgentRuntimeFoundationOptions): Promise<AgentRuntimeFoundation> {
    const service = await createReadyService(options.config, options.modelRuntime);
    options.lifecycle.add(() => service.dispose());
    const knowledgeDirectory = resolveAgentHostKnowledgeDirectory(
      options.config,
      options.projectRoot,
    );
    const knowledgeIndex = knowledgeDirectory
      ? new MarkdownKnowledgeIndex(knowledgeDirectory)
      : undefined;
    const semanticMemory = options.config.memory?.semantic?.enabled === true
      ? new SemanticMemoryRuntime({ recall: options.config.memory?.semantic?.recall })
      : null;
    if (semanticMemory) options.lifecycle.add(() => semanticMemory.dispose());
    const traceRuntime = createAgentTraceRuntime();
    const approvalJudgment: ApprovalJudgmentPort = { judge(input) {
      const models = getAgentTurnConfiguration()?.models;
      if (!models) return Promise.reject(new Error('Approval inference requires an admitted model operation'));
      return new LlmApprovalJudgment({ completion: models.chat.completion, model: models.chat.model }).judge(input);
    } };
    const approvalReviewer = new ApprovalReviewAgent({ judgment: approvalJudgment });
    const bypassApprovalPort = createBypassApprovalPort();
    const approvalMode = service.getAgentConfig()?.execApprovalMode ?? 'auto';
    const defaultApprovalPort = options.approvalPort
      ?? (approvalMode === 'auto'
        ? createAutoApprovalPort(approvalReviewer)
        : approvalMode === 'bypass' ? bypassApprovalPort : undefined);

    try {
      const created = createRuntimeZhinAgent({ service, im: options.im,
        approvalPort: defaultApprovalPort, audioTranscriber: options.audioTranscriber,
        localAssets: options.localAssets,
      });
      options.lifecycle.add(() => created.agent.dispose());
      options.lifecycle.add(() => created.events.clear());
      options.resources.provide(agentEventBusToken, created.events);
      options.resources.provide(aiCompletionToken, createAiCompletion({
        service,
        acquireDefaultModel: (signal, bindingName) => options.acquireDeploymentModels({ service, signal, bindingName }),
        usageQuota: created.agent.usageQuota,
      }));

      const schedule = createAssistantScheduleRuntime(
        created.agent,
        service,
        options.processRuntime,
        options.im,
        options.projectRoot,
        options.assistantConfig,
        traceRuntime,
        resolveLocale(options.resources.has(projectLocaleToken) ? options.resources.use(projectLocaleToken) : undefined),
      );
      options.lifecycle.add(schedule.dispose);
      const home = await createAssistantHomeRuntime(
        options.projectRoot,
        options.assistantConfig,
        schedule.notificationRouter,
        schedule.bindCallHaService,
        schedule.defaultNotify,
      );
      options.lifecycle.add(home.dispose);
      if (home.homeActive) {
        getLogger('agent').info(formatCompact({
          op: 'agent_host_home',
          enabled: true,
          watch: home.watchActive,
          tools: home.tools.length,
        }));
      }

      return new AgentRuntimeFoundation({
        withModelSelection: async (input, run) => {
          const runtime = options.modelRuntime.inferenceFactory(input);
          const scope = await runtime.openScope({ context: { rootId: options.modelRuntime.rootId,
            hostOwnerId: options.modelRuntime.hostOwnerId, ownerId: options.modelRuntime.hostOwnerId, operationId: randomUUID() }, signal: input.signal });
          try { return await run(await scope.resolve({ kind: 'language', purpose: input.bindingName === 'zhin' ? 'chat' : `agent:${input.bindingName}` })); }
          finally { await scope.close(); runtime.retire(); }
        },
        withModels: async (input, run) => {
          const activeBinding = service.getBindingRegistry().getBinding(input.bindingName);
          if (!activeBinding) throw new Error('Workroom model role is unavailable');
          const models = await options.acquireDeploymentModels({ service, bindingName: input.bindingName,
            sessionKey: input.sessionKey, operationId: input.turnId, lease: input.lease, signal: input.signal });
          try { return await runWithAgentTurnConfiguration({ models, activeBinding }, () => run(models)); }
          finally { await models.release(); }
        },
        service,
        agent: created.agent,
        composition: created.runtime,
        knowledgeIndex,
        semanticMemory,
        traceRuntime,
        schedule,
        home,
        sessionTreeRuntime: createSessionTreeRuntimeFromAgent(created.runtime.host, async operation => {
          const models = await options.acquireDeploymentModels({ service });
          try { return await runWithAgentTurnConfiguration({ models, activeBinding: service.getBindingRegistry().requireZhinBinding() }, operation); }
          finally { await models.release(); }
        }),
        approvalReviewer,
        approvalJudgment,
        bypassApprovalPort,
      });
    } catch (error) {
      throw new Error('Agent Host candidate initialization failed', { cause: error });
    }
  }

  listBindings() {
    return Object.freeze(
      this.service.getBindingRegistry().listAgentNames()
        .map(name => this.service.getBindingRegistry().getBinding(name))
        .filter((entry): entry is NonNullable<typeof entry> => entry != null)
        .map(entry => Object.freeze({ ...entry, mcpServers: [...entry.mcpServers] })),
    );
  }
}

async function createReadyService(config: AgentHostAIConfig, modelRuntime: ModelRuntimeServiceOptions): Promise<AIService> {
  let service: AIService | undefined;
  try {
    service = new AIService(config);
    await service.prepareModelRuntime(modelRuntime);
  } catch (error) {
    await service?.dispose().catch(() => undefined);
    throw new Error('Agent Host rejected invalid AI configuration', { cause: error });
  }
  if (!service.getBindingRegistry().getBinding('zhin')) {
    await service.dispose();
    throw new Error('Agent Host requires a ready ai.agents.zhin binding');
  }
  return service;
}
