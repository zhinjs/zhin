/**
 * AIService — AI 服务核心类
 * 统一管理多个模型提供商，提供会话和 Agent 能力
 */

import type { Plugin, AITriggerConfig } from '@zhin.js/core';
import { createSyntheticMessage } from '@zhin.js/core';
import type { Tool } from '@zhin.js/core'
import type { AIProvider, AIConfig, ChatMessage, ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk, AgentTool, ContentPart, Usage } from '@zhin.js/ai';
import {
  SessionManager,
  createMemorySessionManager,
  type ImageGenerationDefaults,
} from '@zhin.js/ai';
import type { ModelRegistry } from '@zhin.js/ai';
import type { ContextManager, ContextConfig } from '@zhin.js/ai';
import { DEFAULT_CONFIG } from './zhin-agent/config.js';
import { normalizeTool } from './orchestrator/tool-selection.js';
import { createWebSearchTool } from './builtin/web-search-tool.js';
import { createAskUserTool } from './builtin/ask-user-tool.js';
import { registerProviderInstances } from './config/provider-instance.js';
import { normalizeAiRoutingConfig, type NormalizedAiRoutingConfig } from './config/normalize-ai-config.js';
import { validateAiRoutingConfig } from './config/validate-ai-config.js';
import { registerLlmApiFromProviders } from '@zhin.js/ai';
import { AgentBindingRegistry } from './config/agent-binding-registry.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './config/types.js';
import {
  runAgentLoopStandaloneTurn,
  type AgentLoopStandaloneResult,
} from './zhin-agent/agent-loop-standalone.js';
import type { ToolCallRecord } from './zhin-agent/tool-calls-user-format.js';
import {
  PluginAILoopHookRegistry,
  type PluginAfterToolCallHandler,
  type PluginBeforeToolCallHandler,
  type PluginTransformContextHandler,
} from './plugin-loop-hooks.js';

/** AIService 程序化 Agent 句柄（agentLoop 隔离上下文，非 legacy `Agent` 类） */
export interface ServiceAgent {
  run(userInput: string | ContentPart[]): Promise<ServiceAgentResult>;
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
  tools?: AgentTool[];
  useBuiltinTools?: boolean;
  collectExternalTools?: boolean;
  maxIterations?: number;
  contextWindow?: number;
}

export class AIService {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProvider: string;
  private routing: NormalizedAiRoutingConfig;
  private bindingRegistry: AgentBindingRegistry;
  public sessions: SessionManager;
  public contextManager?: ContextManager;
  private builtinTools!: AgentTool[];
  private sessionConfig: { maxHistory?: number; expireMs?: number };
  private contextConfig: ContextConfig;
  private triggerConfig: AITriggerConfig;
  private agentConfig: AIConfig['agent'];
  private imageGenerationGlobal?: ImageGenerationDefaults;
  private plugin?: Plugin;
  private customTools: Map<string, AgentTool> = new Map();
  private _modelRegistry: ModelRegistry | null = null;
  readonly loopHooks = new PluginAILoopHookRegistry();

  constructor(config: AIConfig = {}) {
    this.routing = normalizeAiRoutingConfig(config);
    const validationErrors = validateAiRoutingConfig(this.routing);
    if (validationErrors.length > 0) {
      throw new Error(`Invalid AI routing config:\n${validationErrors.map(e => `  - ${e}`).join('\n')}`);
    }

    this.providers = registerProviderInstances(this.routing.providers);
    this.refreshLlmApiRegistry();
    const zhinProvider = this.routing.agents[DEFAULT_ZHIN_AGENT_NAME]?.provider;
    this.defaultProvider =
      zhinProvider
      || config.defaultProvider
      || this.providers.keys().next().value
      || 'openai';

    this.bindingRegistry = new AgentBindingRegistry(this.routing.agents);
    this.sessionConfig = config.sessions || {};
    this.contextConfig = config.context || {};
    this.triggerConfig = config.trigger || {};
    this.agentConfig = config.agent;
    this.imageGenerationGlobal = config.imageGeneration;
    this.sessions = createMemorySessionManager(this.sessionConfig);
    this.refreshBuiltinAgentTools();
  }

  getRoutingConfig(): NormalizedAiRoutingConfig {
    return this.routing;
  }

  getBindingRegistry(): AgentBindingRegistry {
    return this.bindingRegistry;
  }

  /** 运行时合并 *.agent.md 发现结果 */
  setDiscoveredAgents(fileMetas: import('./discovery/agents.js').AgentMeta[]): void {
    this.bindingRegistry = new AgentBindingRegistry(this.routing.agents, fileMetas);
  }

  isReady(): boolean {
    return this.providers.size > 0;
  }

  setSessionManager(manager: SessionManager): void { this.sessions.dispose(); this.sessions = manager; }
  setContextManager(manager: ContextManager): void {
    this.contextManager = manager;
    const defaultProvider = this.providers.get(this.defaultProvider);
    if (defaultProvider) manager.setAIProvider(defaultProvider);
  }
  setPlugin(plugin: Plugin): void {
    this.plugin = plugin;
    this.refreshBuiltinAgentTools();
  }
  setModelRegistry(registry: ModelRegistry): void { this._modelRegistry = registry; }
  getModelRegistry(): ModelRegistry | null { return this._modelRegistry; }
  registerTool(tool: AgentTool): () => void { this.customTools.set(tool.name, tool); return () => { this.customTools.delete(tool.name); }; }

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

  collectAllTools(): AgentTool[] {
    const tools: AgentTool[] = [...this.builtinTools, ...this.customTools.values()];
    return tools;
  }

  /**
   * IM / ZhinAgent 流水线用的常驻 Tool 实例（未经 normalize；与 ToolFeature 工具合并后由 collectRelevantTools 绑定 context）。
   */
  getResidentToolsAsTools(): Tool[] {
    const tools: Tool[] = [createWebSearchTool()];
    if (this.plugin) tools.push(createAskUserTool(this.plugin));
    return tools;
  }

  /** `web_search` 始终挂载；`ask_user` 在 {@link setPlugin} 之后挂载（依赖 Prompt / 中间件）。 */
  private refreshBuiltinAgentTools(): void {
    const next: AgentTool[] = [normalizeTool(createWebSearchTool())];
    if (this.plugin) next.push(normalizeTool(createAskUserTool(this.plugin)));
    this.builtinTools = next;
  }

  getContextConfig(): ContextConfig { return this.contextConfig; }
  getSessionConfig() { return this.sessionConfig; }
  getTriggerConfig(): AITriggerConfig { return this.triggerConfig; }
  /** 部署级 harness（execSecurity 等）；工具由编排 + TF-IDF + 角色（子 agent）选用 */
  getAgentConfig(): AIConfig['agent'] { return this.agentConfig; }

  /** 文生图默认：ai.imageGeneration + providers.<alias>.imageGeneration */
  getImageGenerationDefaults(providerAlias: string): ImageGenerationDefaults {
    const inst = this.routing.providers[providerAlias]?.imageGeneration;
    return { ...this.imageGenerationGlobal, ...inst };
  }

  registerProvider(provider: AIProvider): void { this.providers.set(provider.name, provider); }
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

  /** 同步 api-registry 白名单：显式 models 用配置，否则留空并由 /v1/models 发现填充 provider.models */
  refreshLlmApiRegistry(): void {
    registerLlmApiFromProviders(
      [...this.providers.entries()].map(([alias, provider]) => ({
        alias,
        provider,
        config: this.routing.providers[alias] ?? {},
        models: this.hasExplicitModelList(alias) ? provider.models : [],
      })),
      (alias: string) => this.providers.get(alias),
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

  async chat(request: ChatCompletionRequest, providerName?: string): Promise<ChatCompletionResponse> {
    return this.getProvider(providerName).chat(request);
  }

  async *chatStream(request: ChatCompletionRequest, providerName?: string): AsyncIterable<ChatCompletionChunk> {
    yield* this.getProvider(providerName).chatStream(request);
  }

  async ask(
    question: string,
    options: { provider?: string; model?: string; systemPrompt?: string; temperature?: number } = {},
  ): Promise<string> {
    const messages: ChatMessage[] = [];
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
    messages.push({ role: 'user', content: question });
    const provider = this.getProvider(options.provider);
    const response = await provider.chat({
      model: options.model || provider.models[0],
      messages,
      temperature: options.temperature,
    });
    const content = response.choices[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  }

  private resolveServiceAgentTools(options: CreateServiceAgentOptions): AgentTool[] {
    const tools: AgentTool[] = [];
    if (options.useBuiltinTools !== false) tools.push(...this.builtinTools);
    if (options.collectExternalTools !== false) tools.push(...this.customTools.values());
    if (options.tools?.length) tools.push(...options.tools);
    return tools;
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
        model,
        systemPrompt,
        tools,
        userInput,
        maxIterations,
        commMessage: createSyntheticMessage({
          adapter: 'service',
          endpoint: 'default',
          sender: { id: 'system', isMaster: true },
          channel: { type: 'private', id: 'system' },
        }),
      }).then(toServiceAgentResult),
      dispose: () => undefined,
    };
  }

  async runAgent(
    task: string | ContentPart[],
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

  dispose(): void { this.sessions.dispose(); this.providers.clear(); }
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
