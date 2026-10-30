/**
 * AIService — AI 服务核心类
 * 统一管理多个模型提供商，提供会话和 Agent 能力
 */

import { type AITriggerConfig, type AIAccessConfig } from '@zhin.js/core';
import { type AIProvider, type AIConfig, type AgentTool, type Usage, type ImageGenerationDefaults, type ModelRegistry, type ContextConfig, createLlmApiRuntime, sdkEntryFromProvider, type LlmApiRuntime, SdkProviderAdapter } from '@zhin.js/ai';
import type { AgentRunInput } from './media/media-types.js';
import { R2ImageAssetPublisher } from './media/r2-image-assets.js';
import type { ImageAssetPublisher, R2ImageStorageConfig } from './media/image-assets.js';
import { DEFAULT_CONFIG, findDeprecatedAgentBindingKeys, findDeprecatedAgentConfigKeys } from './config/index.js';
import { getLogger } from '@zhin.js/logger';
import { runWithAgentTurnConfiguration } from './turn/agent-turn-context.js';
import { ModelRuntimeService } from './model-runtime/service.js';
import type { ModelRuntimeConfig, ModelRuntimeServiceOptions, ModelExecutionLease } from './model-runtime/types.js';
import { registerProviderInstances } from './config/provider-instance.js';
import { normalizeAiRoutingConfig, normalizeProviderEntry, type NormalizedAiRoutingConfig } from './config/normalize-ai-config.js';
import { validateAiRoutingConfig } from './config/validate-ai-config.js';
import { AgentBindingRegistry } from './config/agent-binding-registry.js';
import { resolvePerceptionConfig, type ResolvedPerceptionConfig } from './config/perception-config.js';
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
}

export interface CreateServiceAgentOptions {
  /** Canonical invocation preset for prepared model runtimes. */
  preset?: string;
  provider?: string;
  model?: string;
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
}

export class AIService {
  readonly imageAssets?: ImageAssetPublisher;
  private providers: Map<string, AIProvider> = new Map();
  private readonly ownedLegacyProviders = new Set<AIProvider>();
  private readonly providerRegistrations = new Set<Promise<void>>();
  private readonly sourceConfig: AIServiceConfig;
  private modelRuntime: ModelRuntimeService | null = null;
  private modelRuntimeOwnerId?: string;
  private readonly compatibilityLeases: ModelExecutionLease[] = [];
  private modelPreparation?: Promise<void>;
  private disposal?: Promise<void>;
  private closing = false;
  private defaultProvider: string;
  private routing: NormalizedAiRoutingConfig;
  private bindingRegistry: AgentBindingRegistry;
  private contextConfig: ContextConfig;
  private triggerConfig: AITriggerConfig;
  private accessConfig: AIAccessConfig;
  private agentConfig: AIConfig['agent'];
  private imageGenerationGlobal?: ImageGenerationDefaults;
  private perceptionConfig?: ResolvedPerceptionConfig;
  private readonly standaloneTools = new StandaloneToolCatalog();
  private _modelRegistry: ModelRegistry | null = null;
  private llmRuntime!: LlmApiRuntime;
  readonly loopHooks = new PluginAILoopHookRegistry();

  constructor(config: AIServiceConfig = {}) {
    this.sourceConfig = config;
    this.imageAssets = config.imageStorage ? new R2ImageAssetPublisher(config.imageStorage) : undefined;
    for (const { agent, key, reason } of findDeprecatedAgentBindingKeys((config as { agents?: unknown }).agents)) {
      logger.warn(`ai.agents.${agent}.${key} 已弃用，${reason} 运行 zhin config check --fix 可移除。`);
    }
    const canonical = config.modelCatalog !== undefined || config.modelPolicy !== undefined
      || Object.values(config.agents ?? {}).some(binding => binding.preset !== undefined);
    this.routing = canonical ? { providers: {}, agents: {}, mcpServerNames: [] } : normalizeAiRoutingConfig(config as AIConfig);
    if (!canonical) {
      const validationErrors = validateAiRoutingConfig(this.routing);
      if (validationErrors.length > 0) {
        throw new Error(`Invalid AI routing config:\n${validationErrors.map(e => `  - ${e}`).join('\n')}`);
      }
    }

    const legacyProviders = canonical ? Object.fromEntries(Object.entries(config.providers ?? {}).map(([alias, entry]) => [alias, normalizeProviderEntry(alias, entry)])) : this.routing.providers;
    this.providers = registerProviderInstances(legacyProviders);
    for (const provider of this.providers.values()) this.ownedLegacyProviders.add(provider);
    this.refreshLlmApiRuntime();
    const zhinProvider = this.routing.agents[DEFAULT_ZHIN_AGENT_NAME]?.provider;
    this.defaultProvider =
      zhinProvider
      || this.providers.keys().next().value
      || '';

    this.bindingRegistry = new AgentBindingRegistry(this.routing.agents);
    this.contextConfig = config.context || {};
    this.triggerConfig = config.trigger || {};
    this.accessConfig = config.access || {};
    this.agentConfig = config.agent;
    for (const { key, reason } of findDeprecatedAgentConfigKeys(config.agent)) {
      logger.warn(`ai.agent.${key} 已弃用，${reason} 运行 zhin config check --fix 可移除。`);
    }
    this.imageGenerationGlobal = config.imageGeneration;
    this.perceptionConfig = resolvePerceptionConfig(
      config.multimodal?.perception,
      Object.keys(legacyProviders),
    );
  }


  /** Host supplies its namespace and execution ports before constructing Agent runtimes. */
  prepareModelRuntime(options: Omit<ModelRuntimeServiceOptions, 'config' | 'hostProviders'>): Promise<void> {
    if (this.closing) return Promise.reject(new Error('AI service is disposed'));
    if (this.modelPreparation) return this.modelPreparation;
    this.modelPreparation = this.prepareModels(options);
    return this.modelPreparation;
  }

  private async prepareModels(options: Omit<ModelRuntimeServiceOptions, 'config' | 'hostProviders'>): Promise<void> {
    await Promise.all([...this.providerRegistrations]);
    const runtime = new ModelRuntimeService({ ...options, config: this.sourceConfig, hostProviders: this.providers,
      takeHostProviderOwnership: provider => {
        if (!this.ownedLegacyProviders.delete(provider)) return undefined;
        return () => provider instanceof SdkProviderAdapter ? provider.dispose() : undefined;
      },
    });
    const leases: ModelExecutionLease[] = [];
    try {
      const routing = runtime.getCompatibilityRouting();
      const primary = runtime.presetForBinding(DEFAULT_ZHIN_AGENT_NAME);
      // The primary Host connection is always admitted first. Remaining compatibility
      // entries serve management/authoring callers, never per-turn model selection.
      const presets = [primary, ...Object.keys(runtime.getCatalogConfig().presets).filter(preset => preset !== primary)];
      const providers = new Map(this.providers);
      const seenConnections = new Set<string>();
      for (const preset of presets) {
        const model = runtime.getCatalogConfig().models[runtime.getCatalogConfig().presets[preset].modelId];
        const connection = runtime.getCatalogConfig().connections[model.connectionId];
        if (connection.ownerId !== options.hostOwnerId || seenConnections.has(connection.id)) continue;
        seenConnections.add(connection.id);
        const lease = await runtime.acquirePreset(preset, { ownerId: options.hostOwnerId });
        leases.push(lease);
        providers.set(lease.provider.name, lease.provider);
      }
      if (this.closing) throw new Error('AI service is disposed');
      this.routing = routing;
      this.bindingRegistry = new AgentBindingRegistry(routing.agents);
      this.providers = providers;
      this.defaultProvider = routing.agents[DEFAULT_ZHIN_AGENT_NAME].provider;
      this.refreshLlmApiRuntime();
      this.compatibilityLeases.push(...leases);
      this.modelRuntimeOwnerId = options.hostOwnerId;
      this.modelRuntime = runtime;
    } catch (error) {
      await Promise.all(leases.map(lease => lease.release().catch(() => undefined)));
      await runtime.dispose().catch(() => undefined);
      throw error;
    }
  }

  getModelRuntime(): ModelRuntimeService {
    if (!this.modelRuntime) throw new Error('AI model runtime is not prepared');
    return this.modelRuntime;
  }

  /** Validated `ai.multimodal.perception`, or undefined when the pre-pass is off. */
  getPerceptionConfig(): ResolvedPerceptionConfig | undefined {
    return this.perceptionConfig;
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

  /** `ai.context` history window settings (ADR 0043), for the Agent runtime. */
  getContextHistoryConfig(): { tokens?: ContextConfig['historyTokens']; maxMessages?: number | string } {
    return { tokens: this.contextConfig.historyTokens, maxMessages: this.contextConfig.maxRecentMessages };
  }

  /** 文生图默认：ai.imageGeneration + providers.<alias>.imageGeneration */
  getImageGenerationDefaults(providerAlias: string): ImageGenerationDefaults {
    const inst = this.sourceConfig.providers?.[providerAlias]?.imageGeneration;
    return { ...this.imageGenerationGlobal, ...inst };
  }

  async registerProvider(provider: SdkProviderAdapter): Promise<void> {
    if (this.closing) throw new Error('AI service is disposed');
    if (this.modelPreparation) throw new Error('Prepared model connections require a new configuration snapshot');
    const registration = this.replaceProvider(provider);
    this.providerRegistrations.add(registration);
    try { await registration; }
    finally { this.providerRegistrations.delete(registration); }
  }

  private async replaceProvider(provider: SdkProviderAdapter): Promise<void> {
    const previous = this.providers.get(provider.name);
    if (previous === provider) return;
    if (previous instanceof SdkProviderAdapter) await previous.dispose();
    if (previous) this.ownedLegacyProviders.delete(previous);
    if (this.closing) throw new Error('AI service is disposed');
    this.providers.set(provider.name, provider);
    this.ownedLegacyProviders.add(provider);
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
      includeRegisteredTools: options.includeRegisteredTools === true,
      explicitTools: options.tools ?? [],
    });
  }

  createAgent(options: CreateServiceAgentOptions = {}): ServiceAgent {
    const tools = this.resolveServiceAgentTools(options);
    const config = { ...DEFAULT_CONFIG, ...(this.agentConfig ?? {}) } as typeof DEFAULT_CONFIG;
    if (this.modelRuntime) {
      const runtime = this.modelRuntime;
      const ownerId = this.modelRuntimeOwnerId!;
      const preset = options.preset ?? (options.provider !== undefined || options.model !== undefined
        ? runtime.presetForLegacyModel(options.provider ?? this.defaultProvider, options.model)
        : undefined);
      return {
        run: async (userInput) => {
          const execution = preset === undefined ? await runtime.acquireDefaultForTurn(options.signal)
            : await runtime.acquirePreset(preset, { ownerId }, options.signal);
          const lease = 'chat' in execution ? execution.chat : execution;
          try {
            const run = () => runAgentLoopStandaloneTurn({
              provider: lease.provider, llmRuntime: lease.llmRuntime,
              imageAssets: this.imageAssets, model: lease.invocation.model.model,
              systemPrompt: options.systemPrompt ?? '', tools, userInput,
              maxIterations: options.maxIterations ?? config.maxIterations, signal: options.signal,
            });
            const result = 'chat' in execution ? await runWithAgentTurnConfiguration({ models: execution }, run) : await run();
            return toServiceAgentResult(result);
          } finally {
            try { await execution.release(); }
            catch {
              // Cleanup cannot change a completed operation or replace its primary error.
              try { logger.warn('AI model lease cleanup failed'); } catch { /* Reporting is advisory. */ }
            }
          }
        },
        dispose: () => undefined,
      };
    }
    if (options.preset !== undefined) throw new Error('AI model runtime is not prepared');
    const provider = this.getProvider(options.provider);
    const model = options.model ?? provider.models[0];
    const systemPrompt = options.systemPrompt ?? '';
    const maxIterations = options.maxIterations ?? config.maxIterations;

    return {
      run: (userInput) => runAgentLoopStandaloneTurn({
        provider,
        resolveProvider: (alias) => this.providers.get(alias),
        llmRuntime: this.llmRuntime,
        imageAssets: this.imageAssets,
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

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closing = true;
    this.disposal = this.disposeResources();
    return this.disposal;
  }

  private async disposeResources(): Promise<void> {
    await this.modelPreparation?.catch(() => undefined);
    // Replacements admitted before shutdown finish before their old owners are closed.
    await Promise.allSettled([...this.providerRegistrations]);
    const failures: unknown[] = [];
    const cleanup = async (operation: () => Promise<void>): Promise<void> => {
      try { await operation(); } catch (error) { failures.push(error); }
    };
    await Promise.all(this.compatibilityLeases.splice(0).map(lease => cleanup(() => lease.release())));
    await cleanup(() => this.modelRuntime?.dispose() ?? Promise.resolve());
    const providers = [...this.ownedLegacyProviders];
    this.ownedLegacyProviders.clear();
    this.providers.clear();
    await Promise.all(providers.map(provider => cleanup(async () => {
      if (!(provider instanceof SdkProviderAdapter)) return;
      try { await provider.dispose(); }
      catch { throw new Error('AI provider cleanup failed'); }
    })));
    if (failures.length) throw failures[0];
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
