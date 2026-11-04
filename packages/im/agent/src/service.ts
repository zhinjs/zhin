import type { AgentStartupConfig } from './config/agent-startup.js';
/**
 * AIService — AI 服务核心类
 * 统一管理多个模型提供商，提供会话和 Agent 能力
 */

import { type AITriggerConfig, type AIAccessConfig } from '@zhin.js/core';
import { type AgentTool, type Usage, type ContextConfig} from '@zhin.js/ai';
import type { AgentRunInput } from './media/media-types.js';
import { R2ImageAssetPublisher } from './media/r2-image-assets.js';
import type { ImageAssetPublisher, R2ImageStorageConfig } from './media/image-assets.js';
import { validateModelRuntimeConfig, DEFAULT_CONFIG, findDeprecatedAgentBindingKeys, findDeprecatedAgentConfigKeys } from './config/index.js';
import { getLogger } from '@zhin.js/logger';
import { runWithAgentTurnConfiguration } from './turn/agent-turn-context.js';
import { ModelRuntimeService } from './model-runtime/service.js';
import type { ModelRuntimeConfig, ModelRuntimeServiceOptions, ModelExecutionScope } from './model-runtime/types.js';
import { AgentBindingRegistry } from './config/agent-binding-registry.js';
import { resolvePerceptionSettings, type PerceptionSettings } from './config/perception-config.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './config/types.js';
import {
  runAgentLoopStandaloneTurn,
  type AgentLoopStandaloneCallbacks,
  type AgentLoopStandaloneResult,
} from './core/agent-loop-standalone.js';
import type { ToolCallRecord } from './core/tool-calls-user-format.js';
import { StandaloneToolCatalog } from './standalone/standalone-tool-catalog.js';
import {
  PluginAILoopHookRegistry,
  type PluginAfterToolCallHandler,
  type PluginBeforeToolCallHandler,
  type PluginTransformContextHandler,
} from './plugin-loop-hooks.js';

const logger = getLogger('AIService');
export interface AIServiceConfig extends ModelRuntimeConfig {
  imageStorage?: R2ImageStorageConfig;
  /** Administrator-authored Console principal bindings; never inferred from a request body. */
  personalPrincipals?: Readonly<Record<string, readonly import('./personal-session/types.js').PersonalSessionOwner[]>>;
}
/** AIService 程序化 Agent 句柄（agentLoop 隔离上下文，非 legacy `Agent` 类） */
export interface ServiceAgent {
  run(userInput: AgentRunInput): Promise<ServiceAgentResult>;
  dispose(): void;
}

export interface ServiceAgentResult {
  content: string;
  toolCalls: ToolCallRecord[];
  usage: Usage;
  iterations: number;
  model: string;
  /** Last actual model response; callers must not infer success from content alone. */
  terminal?: AgentLoopStandaloneResult['terminal'];
}

export interface CreateServiceAgentOptions {
  /** Borrowed operation scope; its caller owns release and the actual generation lease. */
  models: ModelExecutionScope;
  systemPrompt?: string;
  tools?: readonly AgentTool[];
  /**
   * Include tools registered on this service via `registerTool()`. Default
   * `false`: a standalone Agent starts with no tools unless they are passed
   * explicitly. For plain text work use `aiCompletionToken` instead.
   */
  includeRegisteredTools?: boolean;
  maxIterations?: number;
  contextWindow?: number;
  /** Cancels provider I/O and releases the caller even for a non-cooperative provider. */
  signal?: AbortSignal;
  /** Receives observed partial results before the original run error is rejected. */
  onInterrupted?: AgentLoopStandaloneCallbacks['onInterrupted'];
}

export class AIService {
  readonly imageAssets?: ImageAssetPublisher;
  private readonly sourceConfig: AIServiceConfig;
  private modelRuntime: ModelRuntimeService | null = null;
  private modelPreparation?: Promise<void>;
  private disposal?: Promise<void>;
  private closing = false;
  private bindingRegistry: AgentBindingRegistry;
  private contextConfig: ContextConfig;
  private triggerConfig: AITriggerConfig;
  private accessConfig: AIAccessConfig;
  private agentConfig: AgentStartupConfig['agent'];
  private perceptionConfig?: PerceptionSettings;
  private readonly standaloneTools = new StandaloneToolCatalog();
  readonly loopHooks = new PluginAILoopHookRegistry();

  constructor(config: AIServiceConfig = {}) {
    const errors = validateModelRuntimeConfig(config, '');
    if (errors.length) throw new Error(errors.join('\n'));
    this.sourceConfig = config;
    this.imageAssets = config.imageStorage ? new R2ImageAssetPublisher(config.imageStorage) : undefined;
    this.bindingRegistry = new AgentBindingRegistry({ zhin: {}, ...config.agents });
    this.contextConfig = config.context || {};
    this.triggerConfig = config.trigger || {};
    this.accessConfig = config.access || {};
    this.agentConfig = config.agent;
    for (const { agent, key, reason } of findDeprecatedAgentBindingKeys(config.agents)) {
      logger.warn(`ai.agents.${agent}.${key} 已弃用，${reason}`);
    }
    for (const { key, reason } of findDeprecatedAgentConfigKeys(config.agent)) {
      logger.warn(`ai.agent.${key} 已弃用，${reason} 运行 zhin config check --fix 可移除。`);
    }
    this.perceptionConfig = config.multimodal?.perception
      ? resolvePerceptionSettings(config.multimodal.perception) : undefined;
  }


  /** Host supplies its namespace and execution ports before constructing Agent runtimes. */
  prepareModelRuntime(options: ModelRuntimeServiceOptions): Promise<void> {
    if (this.closing) return Promise.reject(new Error('AI service is disposed'));
    if (!this.modelPreparation) {
      this.modelRuntime = new ModelRuntimeService(options);
      this.modelPreparation = Promise.resolve();
    }
    return this.modelPreparation;
  }

  getModelRuntime(): ModelRuntimeService {
    if (!this.modelRuntime) throw new Error('AI model runtime is not prepared');
    return this.modelRuntime;
  }

  /** Validated `ai.multimodal.perception`, or undefined when the pre-pass is off. */
  getPerceptionConfig(): PerceptionSettings | undefined {
    return this.perceptionConfig;
  }

  getBindingRegistry(): AgentBindingRegistry {
    return this.bindingRegistry;
  }

  /** 运行时合并 agents/<name>/agent.json 发现结果 */
  setDiscoveredAgents(fileMetas: import('./discovery/agents.js').AgentMeta[]): void {
    this.bindingRegistry = new AgentBindingRegistry({ zhin: {}, ...this.sourceConfig.agents }, fileMetas);
  }

  isReady(): boolean {
    return !this.closing && this.modelRuntime !== null;
  }

  registerTool(tool: AgentTool): () => void {
    return this.standaloneTools.register(tool);
  }

  /** ADR 0010 — bridge plugin beforeToolCall hooks to agentLoop. */
  onBeforeToolCall(handler: PluginBeforeToolCallHandler): () => void {
    return this.loopHooks.onBeforeToolCall(handler);
  }

  onAfterToolCall(handler: PluginAfterToolCallHandler): () => void {
    return this.loopHooks.onAfterToolCall(handler);
  }

  /** Run after built-in compaction in transformContext chain. */
  onTransformContext(handler: PluginTransformContextHandler): () => void {
    return this.loopHooks.onTransformContext(handler);
  }

  /** Snapshot the tools explicitly registered for standalone service agents. */
  listRegisteredTools(): readonly AgentTool[] {
    return this.standaloneTools.snapshot();
  }

  getContextConfig(): ContextConfig { return this.contextConfig; }
  getTriggerConfig(): AITriggerConfig { return this.triggerConfig; }
  getAccessConfig(): AIAccessConfig { return this.accessConfig; }
  /** 部署级 harness（execSecurity 等）；工具由编排 + TF-IDF + 角色（子 agent）选用 */
  getAgentConfig(): AgentStartupConfig['agent'] { return this.agentConfig; }

  /** `ai.context` history window settings (ADR 0043), for the Agent runtime. */
  getContextHistoryConfig(): { tokens?: ContextConfig['historyTokens']; maxMessages?: number | string } {
    return { tokens: this.contextConfig.historyTokens, maxMessages: this.contextConfig.maxRecentMessages };
  }


  private resolveServiceAgentTools(options: CreateServiceAgentOptions): AgentTool[] {
    return this.standaloneTools.resolve({
      includeRegisteredTools: options.includeRegisteredTools === true,
      explicitTools: options.tools ?? [],
    });
  }

  createAgent(options: CreateServiceAgentOptions): ServiceAgent {
    if (this.closing) throw new Error('AI service is disposed');
    const tools = this.resolveServiceAgentTools(options);
    const models = options.models;
    return {
      run: userInput => runWithAgentTurnConfiguration({ models }, () => runAgentLoopStandaloneTurn({
        execution: models.chat, imageAssets: this.imageAssets,
        systemPrompt: options.systemPrompt ?? '', tools, userInput,
        maxIterations: options.maxIterations ?? DEFAULT_CONFIG.maxIterations,
        signal: options.signal,
        callbacks: { onInterrupted: options.onInterrupted },
      })).then(toServiceAgentResult),
      dispose: () => undefined,
    };
  }

  async runAgent(
    task: AgentRunInput,
    options: CreateServiceAgentOptions,
  ): Promise<ServiceAgentResult> {
    const agent = this.createAgent(options);
    try {
      return await agent.run(task);
    } finally {
      agent.dispose();
    }
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closing = true;
    this.disposal = this.disposeResources();
    return this.disposal;
  }

  private async disposeResources(): Promise<void> {
    await this.modelPreparation;
    await this.modelRuntime?.dispose();
  }

}

function toServiceAgentResult(result: AgentLoopStandaloneResult): ServiceAgentResult {
  return {
    content: result.content,
    toolCalls: result.toolCalls,
    usage: result.usage,
    iterations: result.iterations,
    model: result.model,
    ...(result.terminal ? { terminal: result.terminal } : {}),
  };
}
