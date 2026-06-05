/**
 * AIService — AI 服务核心类
 * 统一管理多个模型提供商，提供会话和 Agent 能力
 */

import type { Plugin, AITriggerConfig } from '@zhin.js/core';
import type {
  AIProvider,
  AIConfig,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  AgentTool,
  Tool,
} from '@zhin.js/core';
import {
  SessionManager,
  createMemorySessionManager,
  type ImageGenerationDefaults,
} from '@zhin.js/ai';
import { Agent, createAgent } from '@zhin.js/ai';
import type { ModelRegistry } from '@zhin.js/ai';
import type { ContextManager, ContextConfig } from '@zhin.js/ai';
import { DEFAULT_CONFIG } from './zhin-agent/config.js';
import { resolveContextBudget } from './zhin-agent/context-budget.js';
import { normalizeTool } from './orchestrator/tool-selection.js';
import { createWebSearchTool } from './builtin/web-search-tool.js';
import { createAskUserTool } from './builtin/ask-user-tool.js';
import { registerProviderInstances } from './config/provider-instance.js';
import { normalizeAiRoutingConfig, type NormalizedAiRoutingConfig } from './config/normalize-ai-config.js';
import { validateAiRoutingConfig } from './config/validate-ai-config.js';
import { AgentBindingRegistry } from './config/agent-binding-registry.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './config/types.js';

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

  constructor(config: AIConfig = {}) {
    this.routing = normalizeAiRoutingConfig(config);
    const validationErrors = validateAiRoutingConfig(this.routing);
    if (validationErrors.length > 0) {
      throw new Error(`Invalid AI routing config:\n${validationErrors.map(e => `  - ${e}`).join('\n')}`);
    }

    this.providers = registerProviderInstances(this.routing.providers);
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
  listProviders(): string[] { return Array.from(this.providers.keys()); }

  getProviderCapabilities(name?: string): { contextWindow?: number; capabilities?: import('@zhin.js/core').ProviderCapabilities } {
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

  createAgent(options: {
    provider?: string;
    model?: string;
    systemPrompt?: string;
    tools?: AgentTool[];
    useBuiltinTools?: boolean;
    collectExternalTools?: boolean;
    maxIterations?: number;
    contextWindow?: number;
  } = {}): Agent {
    const provider = this.getProvider(options.provider);
    let tools: AgentTool[] = [];
    if (options.useBuiltinTools !== false) tools.push(...this.builtinTools);
    if (options.collectExternalTools !== false) { tools.push(...this.customTools.values()); }
    if (options.tools?.length) tools.push(...options.tools);
    const config = { ...DEFAULT_CONFIG, ...(this.agentConfig ?? {}) } as typeof DEFAULT_CONFIG;
    const model = options.model ?? provider.models[0];
    const contextWindow = options.contextWindow ?? resolveContextBudget({
      config,
      provider,
      modelRegistry: this._modelRegistry,
      model,
    }).contextWindow;
    return createAgent(provider, {
      model,
      systemPrompt: options.systemPrompt,
      tools,
      maxIterations: options.maxIterations,
      contextWindow,
    });
  }

  async runAgent(
    task: string,
    options: { provider?: string; model?: string; tools?: AgentTool[]; systemPrompt?: string } = {},
  ): Promise<{ content: string; toolCalls: any[]; usage: any }> {
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
