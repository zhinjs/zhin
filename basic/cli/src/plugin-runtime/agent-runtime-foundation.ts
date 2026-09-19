import { formatCompact, getLogger } from '@zhin.js/logger';
import type { ImRuntime } from '@zhin.js/core/runtime';
import {
  AIService,
  type ApprovalPort,
  type AssistantConfig,
  type AudioTranscriptionPort,
} from '@zhin.js/agent';
import {
  type AgentRuntime,
  MarkdownKnowledgeIndex,
  SemanticMemoryRuntime,
  agentEventBusToken,
  createAgentTraceRuntime,
  createSessionTreeRuntimeFromAgent,
} from '@zhin.js/agent/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import {
  resolveAgentHostKnowledgeDirectory,
  type AgentHostAIConfig,
} from './agent-host-config.js';
import { createRuntimeZhinAgent } from './agent-runtime-factory.js';
import {
  createAssistantHomeRuntime,
  createAssistantScheduleRuntime,
} from './assistant-runtime.js';

type RootResourceContext = Parameters<RootResourceInstaller>[0];
type RuntimeZhinAgent = ReturnType<typeof createRuntimeZhinAgent>;
type AssistantHomeRuntime = Awaited<ReturnType<typeof createAssistantHomeRuntime>>;

export interface AgentRuntimeFoundationOptions {
  readonly config: AgentHostAIConfig;
  readonly assistantConfig?: AssistantConfig;
  readonly im: ImRuntime;
  readonly projectRoot: string;
  readonly processRuntime: AgentRuntime;
  readonly approvalPort?: ApprovalPort;
  readonly audioTranscriber?: AudioTranscriptionPort;
  readonly resources: RootResourceContext['resources'];
  readonly lifecycle: RootResourceContext['lifecycle'];
}

interface AgentRuntimeFoundationState {
  readonly service: AIService;
  readonly agent: RuntimeZhinAgent['agent'];
  readonly composition: RuntimeZhinAgent['runtime'];
  readonly knowledgeIndex?: MarkdownKnowledgeIndex;
  readonly semanticMemory: SemanticMemoryRuntime | null;
  readonly traceRuntime: ReturnType<typeof createAgentTraceRuntime>;
  readonly schedule: ReturnType<typeof createAssistantScheduleRuntime>;
  readonly home: AssistantHomeRuntime;
  readonly sessionTreeRuntime: ReturnType<typeof createSessionTreeRuntimeFromAgent>;
  readonly seedPresets: RuntimeZhinAgent['seedPresets'];
}

/** A complete, validated Agent runtime candidate with all owned auxiliaries. */
export class AgentRuntimeFoundation {
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
  readonly #seedPresetResources: RuntimeZhinAgent['seedPresets'];

  private constructor(state: AgentRuntimeFoundationState) {
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
    this.#seedPresetResources = state.seedPresets;
  }

  static async create(options: AgentRuntimeFoundationOptions): Promise<AgentRuntimeFoundation> {
    const service = await createReadyService(options.config);
    options.lifecycle.add(() => service.dispose());
    const knowledgeDirectory = resolveAgentHostKnowledgeDirectory(
      options.config,
      options.projectRoot,
    );
    const knowledgeIndex = knowledgeDirectory
      ? new MarkdownKnowledgeIndex(knowledgeDirectory)
      : undefined;
    const semanticMemory = options.config.memory?.semantic?.enabled === true
      ? new SemanticMemoryRuntime()
      : null;
    if (semanticMemory) options.lifecycle.add(() => semanticMemory.dispose());
    const traceRuntime = createAgentTraceRuntime();

    try {
      const created = createRuntimeZhinAgent(
        service,
        options.im,
        options.projectRoot,
        options.approvalPort,
        options.audioTranscriber,
        knowledgeIndex,
      );
      options.lifecycle.add(() => created.agent.dispose());
      options.lifecycle.add(() => created.events.clear());
      options.resources.provide(agentEventBusToken, created.events);

      const schedule = createAssistantScheduleRuntime(
        created.agent,
        service,
        options.processRuntime,
        options.im,
        options.projectRoot,
        options.assistantConfig,
        traceRuntime,
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
        service,
        agent: created.agent,
        composition: created.runtime,
        knowledgeIndex,
        semanticMemory,
        traceRuntime,
        schedule,
        home,
        sessionTreeRuntime: createSessionTreeRuntimeFromAgent(created.runtime.host),
        seedPresets: created.seedPresets,
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

  seedPresets(): Promise<number> {
    return this.#seedPresetResources();
  }
}

async function createReadyService(config: AgentHostAIConfig): Promise<AIService> {
  let service: AIService;
  try {
    service = new AIService(config);
  } catch (error) {
    throw new Error('Agent Host rejected invalid AI configuration', { cause: error });
  }
  if (!service.isReady()) {
    await service.dispose();
    throw new Error('Agent Host requires at least one ready AI provider');
  }
  if (!service.getBindingRegistry().getBinding('zhin')) {
    await service.dispose();
    throw new Error('Agent Host requires a ready ai.agents.zhin binding');
  }
  return service;
}
