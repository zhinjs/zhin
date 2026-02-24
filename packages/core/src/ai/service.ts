/**
 * AIService — AI 服务核心类
 * 统一管理多个模型提供商，提供会话和 Agent 能力
 */

import { Logger } from '@zhin.js/logger';
import type { Plugin } from '../plugin.js';
import type { Tool, ToolContext } from '../types.js';
import type { AITriggerConfig } from '../built/ai-trigger.js';
import type {
  AIProvider,
  AIConfig,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  AgentTool,
} from './types.js';
import {
  OpenAIProvider,
  DeepSeekProvider,
  MoonshotProvider,
  ZhipuProvider,
  AnthropicProvider,
  OllamaProvider,
} from './providers/index.js';
import {
  SessionManager,
  createMemorySessionManager,
  createDatabaseSessionManager,
} from './session.js';
import { Agent, createAgent } from './agent.js';
import { getBuiltinTools } from './tools.js';
import type { ContextManager, ContextConfig } from './context-manager.js';

const aiLogger = new Logger(null, 'AI');

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

    if (config.providers?.openai?.apiKey) {
      this.registerProvider(new OpenAIProvider(config.providers.openai));
    }
    if (config.providers?.anthropic?.apiKey) {
      this.registerProvider(new AnthropicProvider(config.providers.anthropic));
    }
    if (config.providers?.deepseek?.apiKey) {
      this.registerProvider(new DeepSeekProvider(config.providers.deepseek));
    }
    if (config.providers?.moonshot?.apiKey) {
      this.registerProvider(new MoonshotProvider(config.providers.moonshot));
    }
    if (config.providers?.zhipu?.apiKey) {
      this.registerProvider(new ZhipuProvider(config.providers.zhipu));
    }
    if (config.providers?.ollama) {
      this.registerProvider(new OllamaProvider(config.providers.ollama));
    }
  }

  isReady(): boolean {
    return this.providers.size > 0;
  }

  private static readonly PRE_EXEC_TIMEOUT = 10_000;

  async process(
    content: string,
    context: ToolContext,
    tools: Tool[],
  ): Promise<string | AsyncIterable<string>> {
    const { platform, senderId, sceneId } = context;
    const sessionId = SessionManager.generateId(platform || '', senderId || '', sceneId);
    const allTools = this.collectAllToolsWithExternal(tools);
    const baseSystemPrompt = '你是一个友好的中文 AI 助手，请始终使用中文回复。';

    if (allTools.length === 0) {
      return this.finishAndSave(sessionId, content, baseSystemPrompt, sceneId);
    }

    const callerPermissionLevel = context.senderPermissionLevel
      ? (AIService.PERM_MAP[context.senderPermissionLevel] ?? 0)
      : (context.isOwner ? 4 : context.isBotAdmin ? 3 : context.isGroupOwner ? 2 : context.isGroupAdmin ? 1 : 0);

    const relevantTools = Agent.filterTools(content, allTools, {
      callerPermissionLevel,
      maxTools: 8,
      minScore: 0.1,
    });

    if (relevantTools.length === 0) {
      return this.finishAndSave(sessionId, content, baseSystemPrompt, sceneId);
    }

    const noParamTools: AgentTool[] = [];
    const paramTools: AgentTool[] = [];
    for (const tool of relevantTools) {
      const required = tool.parameters?.required;
      (!required || required.length === 0) ? noParamTools.push(tool) : paramTools.push(tool);
    }

    let preExecutedData = '';
    const preExecutedCalls: { tool: string; args: Record<string, any>; result: any }[] = [];

    if (noParamTools.length > 0) {
      const results = await Promise.allSettled(
        noParamTools.map(async (tool) => {
          const result = await Promise.race([
            tool.execute({}),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('预执行超时')), AIService.PRE_EXEC_TIMEOUT)),
          ]);
          return { name: tool.name, result };
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const s = typeof r.value.result === 'string' ? r.value.result : JSON.stringify(r.value.result);
          preExecutedData += `\n【${r.value.name}】${s}`;
          preExecutedCalls.push({ tool: r.value.name, args: {}, result: r.value.result });
        }
      }
    }

    let finalResponse: string;

    if (paramTools.length === 0 && preExecutedData) {
      const singleShotPrompt = `你是一个友好的中文 AI 助手。\n\n以下是根据用户问题自动获取的实时数据：\n${preExecutedData}\n\n请基于以上数据回答用户的问题。用自然流畅的中文组织信息，突出重点。`;
      finalResponse = await this.simpleChat(content, singleShotPrompt);
    } else {
      const agentSystemPrompt = `你是一个友好的中文 AI 助手。
${preExecutedData ? `\n已自动获取的数据：${preExecutedData}\n` : ''}
## 关键要求
- 调用工具后**必须**基于结果给出完整中文回答
- 用自然语言总结，突出关键信息`;

      const agent = this.createAgent({
        systemPrompt: agentSystemPrompt,
        tools: paramTools.length > 0 ? paramTools : relevantTools,
        useBuiltinTools: false,
        collectExternalTools: false,
        maxIterations: 3,
      });

      const agentResult = await agent.run(content);
      finalResponse = agentResult.content || this.formatToolCallsFallback(
        [...preExecutedCalls, ...agentResult.toolCalls],
      );
    }

    await this.sessions.addMessage(sessionId, { role: 'user', content });
    await this.sessions.addMessage(sessionId, { role: 'assistant', content: finalResponse });
    if (this.contextManager && sceneId) {
      this.contextManager.autoSummarizeIfNeeded(sceneId).catch(() => {});
    }
    return finalResponse;
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

  private formatToolCallsFallback(toolCalls: { tool: string; args: any; result: any }[]): string {
    if (toolCalls.length === 0) return '处理完成。';
    return toolCalls.map(tc => {
      const s = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2);
      return `【${tc.tool}】\n${s}`;
    }).join('\n\n');
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

  private collectAllToolsWithExternal(externalTools: Tool[]): AgentTool[] {
    const tools: AgentTool[] = [];
    tools.push(...this.builtinTools);
    tools.push(...this.customTools.values());
    for (const tool of externalTools) {
      if (tool.name.startsWith('cmd_') || tool.name.startsWith('process_')) continue;
      tools.push(this.convertToolToAgentTool(tool));
    }
    if (tools.length > 30) return tools.slice(0, 30);
    return tools;
  }

  private static readonly PERM_MAP: Record<string, number> = {
    'user': 0, 'group_admin': 1, 'group_owner': 2, 'bot_admin': 3, 'owner': 4,
  };

  private convertToolToAgentTool(tool: Tool): AgentTool {
    const agentTool: AgentTool = {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as any,
      execute: tool.execute,
    };
    if (tool.tags?.length) agentTool.tags = tool.tags;
    if (tool.permissionLevel) agentTool.permissionLevel = AIService.PERM_MAP[tool.permissionLevel] ?? 0;
    if ((tool as any).keywords?.length) agentTool.keywords = (tool as any).keywords;
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
