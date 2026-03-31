/**
 * AIService — AI 服务核心类
 * 统一管理多个模型提供商，提供会话和 Agent 能力
 */

import { Logger } from '@zhin.js/core';
import type { Plugin, Tool, ToolContext, AITriggerConfig } from '@zhin.js/core';
import type {
  AIProvider,
  AIConfig,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  AgentTool,
} from '@zhin.js/core';
import {
  OpenAIProvider,
  DeepSeekProvider,
  MoonshotProvider,
  ZhipuProvider,
  AnthropicProvider,
  OllamaProvider,
} from '@zhin.js/core';
import {
  SessionManager,
  createMemorySessionManager,
} from '@zhin.js/ai';
import { Agent, createAgent } from '@zhin.js/ai';
import { getBuiltinTools } from './tools.js';
import type { ContextManager, ContextConfig } from '@zhin.js/ai';
import { PERM_MAP } from './zhin-agent/config.js';

const aiLogger = new Logger(null, 'AI');

/** Provider 注册表：key → 构造函数 + 是否需要 apiKey */
const PROVIDER_REGISTRY: Array<{
  key: keyof NonNullable<AIConfig['providers']>;
  factory: new (config: any) => AIProvider;
  requireApiKey: boolean;
}> = [
  { key: 'openai', factory: OpenAIProvider, requireApiKey: true },
  { key: 'anthropic', factory: AnthropicProvider, requireApiKey: true },
  { key: 'deepseek', factory: DeepSeekProvider, requireApiKey: true },
  { key: 'moonshot', factory: MoonshotProvider, requireApiKey: true },
  { key: 'zhipu', factory: ZhipuProvider, requireApiKey: true },
  { key: 'ollama', factory: OllamaProvider, requireApiKey: false },
];

export class AIService {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProvider: string;
  public sessions: SessionManager;
  public contextManager?: ContextManager;
  private builtinTools: AgentTool[];
  private sessionConfig: { maxHistory?: number; expireMs?: number };
  private contextConfig: ContextConfig;
  private triggerConfig: AITriggerConfig;
  private agentConfig: AIConfig['agent'];
  private plugin?: Plugin;
  private customTools: Map<string, AgentTool> = new Map();

  constructor(config: AIConfig = {}) {
    this.defaultProvider = config.defaultProvider || 'openai';
    this.sessionConfig = config.sessions || {};
    this.contextConfig = config.context || {};
    this.triggerConfig = config.trigger || {};
    this.agentConfig = config.agent;
    this.sessions = createMemorySessionManager(this.sessionConfig);
    this.builtinTools = getBuiltinTools().map(tool => this.convertToolToAgentTool(tool.toTool()));

    for (const { key, factory, requireApiKey } of PROVIDER_REGISTRY) {
      const providerConfig = config.providers?.[key];
      if (!providerConfig) continue;
      if (requireApiKey && !(providerConfig as any).apiKey) continue;
      this.registerProvider(new factory(providerConfig as any));
    }
  }

  isReady(): boolean {
    return this.providers.size > 0;
  }

  async process(
    content: string,
    context: ToolContext,
    _tools: Tool[],
  ): Promise<string> {
    const { platform, senderId, sceneId } = context;
    const sessionId = SessionManager.generateId(platform || '', senderId || '', sceneId);
    const systemPrompt = 'You are a helpful AI assistant. Reply in the language specified in [User profile] (key: language / preferred_language), or in the user\'s message language if not set.';
    return this.finishAndSave(sessionId, content, systemPrompt, sceneId);
  }

  private async finishAndSave(sessionId: string, content: string, systemPrompt: string, sceneId?: string): Promise<string> {
    const response = await this.simpleChat(content, systemPrompt);
    await this.sessions.addMessage(sessionId, { role: 'user', content });
    await this.sessions.addMessage(sessionId, { role: 'assistant', content: response });
    if (this.contextManager && sceneId) {
      this.contextManager.autoSummarizeIfNeeded(sceneId).catch(() => {});
    }
    return response;
  }

  private async simpleChat(content: string, systemPrompt: string): Promise<string> {
    const provider = this.getProvider();
    const response = await this.chat({
      model: provider.models[0],
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
    });
    const msgContent = response.choices[0]?.message?.content;
    return typeof msgContent === 'string' ? msgContent : '';
  }

  private convertToolToAgentTool(tool: Tool): AgentTool {
    const agentTool: AgentTool = {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async (args) => tool.execute(args),
    };
    if (tool.tags?.length) agentTool.tags = tool.tags;
    if (tool.permissionLevel) agentTool.permissionLevel = PERM_MAP[tool.permissionLevel] ?? 0;
    if (tool.keywords?.length) agentTool.keywords = tool.keywords;
    return agentTool;
  }

  setSessionManager(manager: SessionManager): void { this.sessions.dispose(); this.sessions = manager; }
  setContextManager(manager: ContextManager): void {
    this.contextManager = manager;
    const defaultProvider = this.providers.get(this.defaultProvider);
    if (defaultProvider) manager.setAIProvider(defaultProvider);
  }
  setPlugin(plugin: Plugin): void { this.plugin = plugin; }
  registerTool(tool: AgentTool): () => void { this.customTools.set(tool.name, tool); return () => { this.customTools.delete(tool.name); }; }

  collectAllTools(): AgentTool[] {
    const tools: AgentTool[] = [...this.builtinTools, ...this.customTools.values()];
    if (this.plugin) {
      for (const tool of this.plugin.collectAllTools()) tools.push(this.convertToolToAgentTool(tool));
    }
    return tools;
  }

  getContextConfig(): ContextConfig { return this.contextConfig; }
  getSessionConfig() { return this.sessionConfig; }
  getTriggerConfig(): AITriggerConfig { return this.triggerConfig; }
  /** Agent 配置（如 disabledTools / allowedTools），供 ZhinAgent 使用 */
  getAgentConfig(): AIConfig['agent'] { return this.agentConfig; }

  registerProvider(provider: AIProvider): void { this.providers.set(provider.name, provider); }
  getProvider(name?: string): AIProvider {
    const providerName = name || this.defaultProvider;
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`AI Provider "${providerName}" not found. Available: ${this.listProviders().join(', ')}`);
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

  async ask(question: string, options: { provider?: string; model?: string; systemPrompt?: string; temperature?: number } = {}): Promise<string> {
    const messages: ChatMessage[] = [];
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
    messages.push({ role: 'user', content: question });
    const provider = this.getProvider(options.provider);
    const response = await provider.chat({ model: options.model || provider.models[0], messages, temperature: options.temperature });
    const content = response.choices[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  }

  createAgent(options: { provider?: string; model?: string; systemPrompt?: string; tools?: AgentTool[]; useBuiltinTools?: boolean; collectExternalTools?: boolean; maxIterations?: number } = {}): Agent {
    const provider = this.getProvider(options.provider);
    let tools: AgentTool[] = [];
    if (options.useBuiltinTools !== false) tools.push(...this.builtinTools);
    if (options.collectExternalTools !== false) { tools.push(...this.customTools.values()); if (this.plugin) { for (const t of this.plugin.collectAllTools()) tools.push(this.convertToolToAgentTool(t)); } }
    if (options.tools?.length) tools.push(...options.tools);
    return createAgent(provider, { model: options.model, systemPrompt: options.systemPrompt, tools, maxIterations: options.maxIterations });
  }

  async runAgent(task: string, options: { provider?: string; model?: string; tools?: AgentTool[]; systemPrompt?: string } = {}): Promise<{ content: string; toolCalls: any[]; usage: any }> {
    return this.createAgent(options).run(task);
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
