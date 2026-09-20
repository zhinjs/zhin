/**
 * AIService — AI 服务核心类
 * 统一管理多个模型提供商，提供会话和 Agent 能力
 */

import { type AITriggerConfig, type AIAccessConfig } from '@zhin.js/core';
import { type AIProvider, type AIConfig, type AgentTool, type Usage, type ImageGenerationDefaults, type ModelRegistry, type ContextConfig, createLlmApiRuntime, sdkEntryFromProvider, type LlmApiRuntime, SdkProviderAdapter } from '@zhin.js/ai';
import type { AgentRunInput } from './media/media-types.js';
import { DEFAULT_CONFIG } from './config/index.js';
import { registerProviderInstances } from './config/provider-instance.js';
import { normalizeAiRoutingConfig, type NormalizedAiRoutingConfig } from './config/normalize-ai-config.js';
import { validateAiRoutingConfig } from './config/validate-ai-config.js';
import { AgentBindingRegistry } from './config/agent-binding-registry.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './config/types.js';
import {
  runAgentLoopStandaloneTurn,
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
}

export interface CreateServiceAgentOptions {
  provider?: string;
  model?: string;
  systemPrompt?: string;
  tools?: readonly AgentTool[];
  /** Include tools explicitly registered on this service. */
  includeRegisteredTools?: boolean;
  maxIterations?: number;
  contextWindow?: number;
  /** Cancels provider I/O and releases the caller even for a non-cooperative provider. */
  signal?: AbortSignal;
}

export class AIService {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProvider: string;
  private routing: NormalizedAiRoutingConfig;
  private bindingRegistry: AgentBindingRegistry;
  private contextConfig: ContextConfig;
  private triggerConfig: AITriggerConfig;
  private accessConfig: AIAccessConfig;
  private agentConfig: AIConfig['agent'];
  private imageGenerationGlobal?: ImageGenerationDefaults;
  private readonly standaloneTools = new StandaloneToolCatalog();
  private _modelRegistry: ModelRegistry | null = null;
  private llmRuntime!: LlmApiRuntime;
  readonly loopHooks = new PluginAILoopHookRegistry();

  constructor(config: AIConfig = {}) {
    this.routing = normalizeAiRoutingConfig(config);
    const validationErrors = validateAiRoutingConfig(this.routing);
    if (validationErrors.length > 0) {
      throw new Error(`Invalid AI routing config:\n${validationErrors.map(e => `  - ${e}`).join('\n')}`);
    }

    this.providers = registerProviderInstances(this.routing.providers);
    this.refreshLlmApiRuntime();
    const zhinProvider = this.routing.agents[DEFAULT_ZHIN_AGENT_NAME]?.provider;
    this.defaultProvider =
      zhinProvider
      || this.providers.keys().next().value
      || 'openai';

    this.bindingRegistry = new AgentBindingRegistry(this.routing.agents);
    this.contextConfig = config.context || {};
    this.triggerConfig = config.trigger || {};
    this.accessConfig = config.access || {};
    this.agentConfig = config.agent;
    this.imageGenerationGlobal = config.imageGeneration;
  }

  getRoutingConfig(): NormalizedAiRoutingConfig {
    return this.routing;
  }

  getBindingRegistry(): AgentBindingRegistry {
    return this.bindingRegistry;
  }

  /** 运行时合并 agents/<name>/agent.json 发现结果 */
  setDiscoveredAgents(fileMetas: import('./discovery/agents.js').AgentMeta[]): void {
    this.bindingRegistry = new AgentBindingRegistry(this.routing.agents, fileMetas);
  }

  isReady(): boolean {
    return this.providers.size > 0;
  }

  setModelRegistry(registry: ModelRegistry): void { this._modelRegistry = registry; }
  getModelRegistry(): ModelRegistry | null { return this._modelRegistry; }
  getLlmRuntime(): LlmApiRuntime { return this.llmRuntime; }
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
  getAgentConfig(): AIConfig['agent'] { return this.agentConfig; }

  /** 文生图默认：ai.imageGeneration + providers.<alias>.imageGeneration */
  getImageGenerationDefaults(providerAlias: string): ImageGenerationDefaults {
    const inst = this.routing.providers[providerAlias]?.imageGeneration;
    return { ...this.imageGenerationGlobal, ...inst };
  }

  async registerProvider(provider: SdkProviderAdapter): Promise<void> {
    const previous = this.providers.get(provider.name);
    if (previous === provider) return;
    if (previous instanceof SdkProviderAdapter) await previous.dispose();
    this.providers.set(provider.name, provider);
    const entry = sdkEntryFromProvider(provider);
    this.llmRuntime.registerProvider(entry.alias, entry.config, entry.models, entry.fetch);
  }
  getProvider(name?: string): AIProvider {
    const providerName = name || this.defaultProvider;
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(
        `AI Provider "${providerName}" not found. Available: ${this.listProviders().join(', ')}`,
      );
    }
    return provider;
  }
  listProviders(): string[] { return Array.from(this.providers.keys());   }

  /** yaml 中显式配置了 models 列表（非空） */
  hasExplicitModelList(alias: string): boolean {
    const models = this.routing.providers[alias]?.models;
    return Array.isArray(models) && models.length > 0;
  }

  /** Build the service-owned transport runtime and its configured model allowlists. */
  private refreshLlmApiRuntime(): void {
    this.llmRuntime = createLlmApiRuntime(
      [...this.providers.entries()].map(([alias, provider]) => {
        const entry = sdkEntryFromProvider(provider);
        return {
          ...entry,
          models: this.hasExplicitModelList(alias) ? entry.models : [],
        };
      }),
      (alias: string) => this.providers.get(alias)?.models ?? [],
    );
  }

  getProviderCapabilities(name?: string): { contextWindow?: number; capabilities?: import('@zhin.js/ai').ProviderCapabilities } {
    const provider = this.getProvider(name);
    return {
      contextWindow: provider.contextWindow,
      capabilities: provider.capabilities,
    };
  }

  async listModels(providerName?: string): Promise<{ provider: string; models: string[] }[]> {
    const result: { provider: string; models: string[] }[] = [];
    if (providerName) {
      const provider = this.getProvider(providerName);
      result.push({ provider: providerName, models: await provider.listModels?.() || provider.models });
    } else {
      for (const [name, provider] of this.providers) {
        result.push({ provider: name, models: await provider.listModels?.() || provider.models });
      }
    }
    return result;
  }

  private resolveServiceAgentTools(options: CreateServiceAgentOptions): AgentTool[] {
    return this.standaloneTools.resolve({
      includeRegisteredTools: options.includeRegisteredTools !== false,
      explicitTools: options.tools ?? [],
    });
  }

  createAgent(options: CreateServiceAgentOptions = {}): ServiceAgent {
    const provider = this.getProvider(options.provider);
    const tools = this.resolveServiceAgentTools(options);
    const config = { ...DEFAULT_CONFIG, ...(this.agentConfig ?? {}) } as typeof DEFAULT_CONFIG;
    const model = options.model ?? provider.models[0];
    const systemPrompt = options.systemPrompt ?? '';
    const maxIterations = options.maxIterations ?? config.maxIterations;

    return {
      run: (userInput) => runAgentLoopStandaloneTurn({
        provider,
        resolveProvider: (alias) => this.providers.get(alias),
        llmRuntime: this.llmRuntime,
        model,
        systemPrompt,
        tools,
        userInput,
        maxIterations,
        signal: options.signal,
      }).then(toServiceAgentResult),
      dispose: () => undefined,
    };
  }

  async runAgent(
    task: AgentRunInput,
    options: CreateServiceAgentOptions = {},
  ): Promise<ServiceAgentResult> {
    const agent = this.createAgent(options);
    try {
      return await agent.run(task);
    } finally {
      agent.dispose();
    }
  }

  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [name, provider] of this.providers) {
      try { results[name] = await provider.healthCheck?.() ?? true; } catch { results[name] = false; }
    }
    return results;
  }

  async dispose(): Promise<void> {
    const providers = [...this.providers.values()];
    this.providers.clear();
    await Promise.all(providers.map((provider) => (
      provider instanceof SdkProviderAdapter ? provider.dispose() : Promise.resolve()
    )));
  }
}

function toServiceAgentResult(result: AgentLoopStandaloneResult): ServiceAgentResult {
  return {
    content: result.content,
    toolCalls: result.toolCalls,
    usage: result.usage,
    iterations: result.iterations,
    model: result.model,
  };
}
