/**
 * @zhin.js/agent - Agent System
 * AI Agent 实现，支持工具调用和多轮对话
 */

import { Logger } from '@zhin.js/logger';
import type {
  AIProvider,
  AgentConfig,
  AgentTool,
  AgentResult,
  ChatMessage,
  ToolDefinition as ChatToolDefinition,
  ToolCall,
  ToolFilterOptions,
  Usage,
} from './types.js';
import { filterTools } from './tool-filter.js';
import { CostTracker } from './cost-tracker.js';
import {
  autoCompactIfNeeded,
  createAutoCompactTracking,
  estimateMessagesTokens,
} from './compaction.js';
import type { AutoCompactTrackingState } from './compaction.js';

const logger = new Logger(null, 'Agent');

/** 工具执行默认超时时间 (ms) */
const DEFAULT_TOOL_TIMEOUT = 30_000;

/** 默认最大并发工具执行数（参考 Claude Code StreamingToolExecutor） */
const DEFAULT_MAX_CONCURRENT_TOOLS = 10;

/**
 * 判断工具是否可并发执行
 *
 * 优先使用显式的 isConcurrencySafe 标记；
 * 其次使用 isReadOnly 推断（只读工具默认可并发）；
 * 无标记时默认不可并发（fail-closed，参考 Claude Code buildTool 模式）。
 */
function isToolConcurrencySafe(tool: AgentTool): boolean {
  if (tool.isConcurrencySafe !== undefined) return tool.isConcurrencySafe;
  if (tool.isReadOnly !== undefined) return tool.isReadOnly;
  return false; // fail-closed: 未标记的工具默认独占执行
}

/**
 * 根据工具名和参数生成简短标题（用于日志、TOOLS.md 等）
 */
export function formatToolTitle(name: string, args?: Record<string, any>): string {
  if (!args || Object.keys(args).length === 0) return name;
  const a = args;
  switch (name) {
    case 'bash': return a.command != null ? `bash: ${String(a.command).slice(0, 60)}` : name;
    case 'read_file': return a.file_path != null ? `read_file: ${a.file_path}` : name;
    case 'write_file': return a.file_path != null ? `write_file: ${a.file_path}` : name;
    case 'edit_file': return a.file_path != null ? `edit_file: ${a.file_path}` : name;
    case 'list_dir': return a.path != null ? `list_dir: ${a.path}` : name;
    case 'web_search': return a.query != null ? `web_search: ${String(a.query).slice(0, 40)}` : name;
    case 'web_fetch': return a.url != null ? `web_fetch: ${String(a.url).slice(0, 50)}` : name;
    default: {
      const first = Object.values(a)[0];
      if (first != null) return `${name}: ${String(first).slice(0, 50)}`;
      return name;
    }
  }
}

/**
 * Agent 执行状态
 */
export interface AgentState {
  messages: ChatMessage[];
  toolCalls: { tool: string; args: Record<string, any>; result: any }[];
  usage: Usage;
  iterations: number;
}

/**
 * Agent 事件
 */
export interface AgentEvents {
  'thinking': (message: string) => void;
  'tool_call': (tool: string, args: Record<string, any>) => void;
  'tool_result': (tool: string, result: any) => void;
  'streaming': (content: string) => void;
  'complete': (result: AgentResult) => void;
  'error': (error: Error) => void;
  /** 循环内压缩完成时触发 */
  'compaction': (info: { microSavedTokens: number; autoSavedTokens: number; totalTokensBefore: number; totalTokensAfter: number }) => void;
}

/**
 * AI Agent 类
 * 支持工具调用、多轮对话、流式输出
 */
export class Agent {
  private provider: AIProvider;
  private config: Required<Pick<AgentConfig, 'provider' | 'model' | 'systemPrompt' | 'tools' | 'maxIterations' | 'temperature'>> & Pick<AgentConfig, 'contextWindow' | 'maxConcurrentTools' | 'modelFallbacks'>;
  private tools: Map<string, AgentTool> = new Map();
  private eventHandlers: Map<keyof AgentEvents, Function[]> = new Map();
  /** 成本追踪器（参考 Claude Code cost-tracker） */
  readonly costTracker: CostTracker = new CostTracker();

  constructor(provider: AIProvider, config: AgentConfig) {
    this.provider = provider;
    this.config = {
      provider: config.provider,
      model: config.model || provider.models[0],
      modelFallbacks: config.modelFallbacks,
      systemPrompt: config.systemPrompt || this.getDefaultSystemPrompt(),
      tools: config.tools || [],
      maxIterations: config.maxIterations || 10,
      temperature: config.temperature ?? 0.7,
      contextWindow: config.contextWindow,
      maxConcurrentTools: config.maxConcurrentTools,
    };

    // 注册工具
    for (const tool of this.config.tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Default system prompt (English). Reply language is determined by user profile or message language.
   */
  private getDefaultSystemPrompt(): string {
    return `You are a helpful assistant that can use tools to complete tasks.

# Principles
 - Understand the user's intent and choose appropriate tools
 - If multiple steps are needed, execute them in order
 - On tool failure, try alternatives — do not dump raw errors to user
 - If a task cannot be completed, say so honestly
 - Reply in the language specified in [User profile] (key: language / preferred_language), or in the user's message language if not set`;
  }

  /**
   * 带自动降级的 chat 调用：主模型失败时依次尝试 modelFallbacks。
   */
  private async chatWithFallback(request: Omit<import('./types.js').ChatCompletionRequest, 'model'>): Promise<{ response: import('./types.js').ChatCompletionResponse; usedModel: string }> {
    const candidates = [this.config.model, ...(this.config.modelFallbacks || [])];
    let lastError: Error | undefined;
    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];
      try {
        const response = await this.provider.chat({ ...request, model });
        // 成功且切换了模型 → 将当前模型提升为首选（后续轮次直接用）
        if (i > 0) {
          logger.info(`[模型降级] ${candidates[0]} → ${model} 成功，切换为首选模型`);
          this.config.model = model;
        }
        return { response, usedModel: model };
      } catch (err) {
        lastError = err as Error;
        if (i < candidates.length - 1) {
          logger.warn(`[模型降级] ${model} 失败: ${lastError.message}，尝试 ${candidates[i + 1]}`);
        }
      }
    }
    throw lastError || new Error('All model candidates failed');
  }

  /**
   * 注册事件处理器
   */
  on<K extends keyof AgentEvents>(event: K, handler: AgentEvents[K]): () => void {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);

    return () => {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    };
  }

  /**
   * 触发事件
   */
  private emit<K extends keyof AgentEvents>(event: K, ...args: Parameters<AgentEvents[K]>): void {
    const handlers = this.eventHandlers.get(event) || [];
    for (const handler of handlers) {
      try {
        (handler as Function)(...args);
      } catch (e) {
        logger.error('事件处理器错误:', e);
      }
    }
  }

  /**
   * 添加工具
   */
  addTool(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 移除工具
   */
  removeTool(name: string): void {
    this.tools.delete(name);
  }

  /**
   * 获取工具定义（缓存在第一次调用后保持不变）
   */
  private getToolDefinitions(): ChatToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * 生成工具调用的去重 key（规范化参数以避免 "" vs "{}" 等差异）
   */
  private static toolCallKey(name: string, args: string): string {
    let normalized: string;
    try {
      const parsed = JSON.parse(args || '{}');
      normalized = JSON.stringify(parsed, Object.keys(parsed).sort());
    } catch {
      normalized = args || '';
    }
    return `${name}::${normalized}`;
  }

  /**
   * 安全解析 JSON，失败则返回原始字符串
   */
  private static safeParse(str: string): any {
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }

  /**
   * 程序化工具过滤 —— TF-IDF 加权的相关性评分
   * @see filterTools (tool-filter.ts) 完整实现
   */
  static filterTools(
    message: string,
    tools: AgentTool[],
    options?: ToolFilterOptions,
  ): AgentTool[] {
    return filterTools(message, tools, options);
  }

  /**
   * 执行单个工具调用（带超时保护）
   */
  private async executeToolCall(toolCall: ToolCall): Promise<string> {
    const tool = this.tools.get(toolCall.function.name);
    if (!tool) {
      return JSON.stringify({
        error: `Unknown tool: ${toolCall.function.name}`,
        hint: '该工具不存在，请尝试使用其他可用工具，或直接回答用户。',
      });
    }

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      return JSON.stringify({
        error: 'Invalid tool arguments JSON',
        tool: toolCall.function.name,
        hint: '请检查工具参数格式后重试。',
      });
    }

    logger.debug({ tool: toolCall.function.name, params: args }, 'Executing tool');
    this.emit('tool_call', tool.name, args);

    try {
      // 带超时的工具执行
      const timeout = tool.timeout ?? DEFAULT_TOOL_TIMEOUT;
      const result = await Promise.race([
        tool.execute(args),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`工具 ${tool.name} 执行超时`)), timeout),
        ),
      ]);

      this.emit('tool_result', tool.name, result);
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`工具 ${toolCall.function.name} 执行失败: ${errorMsg}`);
      logger.error({ tool: toolCall.function.name, params: args, err: error }, 'Tool execution failed');
      // 向 AI 提供结构化的错误信息和恢复提示
      return JSON.stringify({
        error: errorMsg,
        tool: toolCall.function.name,
        hint: '该工具执行失败。请尝试使用不同的参数重试，或换一个工具来完成任务。如果所有工具都无法使用，请直接用文字回答用户。',
      });
    }
  }

  /**
   * 并行执行多个工具调用（跳过重复的）
   *
   * 并发控制策略（参考 Claude Code StreamingToolExecutor）：
   * - 所有工具分为"并发安全"和"独占"两类
   * - 并发安全工具可同时执行（上限 maxConcurrentTools，默认 10）
   * - 独占工具串行执行，等待前面所有工具完成后再开始
   *
   * @returns 新执行的工具调用结果列表；如果全部重复则返回空数组
   */
  private async executeToolCalls(
    toolCalls: ToolCall[],
    seenKeys: Set<string>,
    state: AgentState,
  ): Promise<{ toolCall: ToolCall; result: string; args: Record<string, any> }[]> {
    // 分离：新调用 vs 重复调用
    const fresh: ToolCall[] = [];
    for (const tc of toolCalls) {
      const key = Agent.toolCallKey(tc.function.name, tc.function.arguments);
      if (seenKeys.has(key)) {
        logger.debug(`跳过重复工具调用: ${tc.function.name}`);
      } else {
        fresh.push(tc);
      }
    }

    if (fresh.length === 0) return [];

    const maxConcurrent = this.config.maxConcurrentTools ?? DEFAULT_MAX_CONCURRENT_TOOLS;

    // 将工具分为并发组和独占组
    const concurrentCalls: ToolCall[] = [];
    const exclusiveCalls: ToolCall[] = [];

    for (const tc of fresh) {
      const tool = this.tools.get(tc.function.name);
      if (tool && isToolConcurrencySafe(tool)) {
        concurrentCalls.push(tc);
      } else {
        exclusiveCalls.push(tc);
      }
    }

    const allResults: { toolCall: ToolCall; result: string; args: Record<string, any> }[] = [];

    // 执行单个工具并记录状态
    const execOne = async (tc: ToolCall) => {
      const result = await this.executeToolCall(tc);
      const args = Agent.safeParse(tc.function.arguments);
      const parsedResult = Agent.safeParse(result);

      const key = Agent.toolCallKey(tc.function.name, tc.function.arguments);
      seenKeys.add(key);
      state.toolCalls.push({
        tool: tc.function.name,
        args: typeof args === 'object' ? args : { raw: args },
        result: parsedResult,
      });

      return { toolCall: tc, result, args };
    };

    // ── 并发安全工具：分批并行，每批最多 maxConcurrent ──
    for (let i = 0; i < concurrentCalls.length; i += maxConcurrent) {
      const batch = concurrentCalls.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(batch.map(execOne));
      allResults.push(...batchResults);
    }

    // ── 独占工具：串行执行 ──
    for (const tc of exclusiveCalls) {
      const result = await execOne(tc);
      allResults.push(result);
    }

    return allResults;
  }

  /**
   * 累加 token 用量
   */
  private static addUsage(target: Usage, source?: Usage): void {
    if (!source) return;
    target.prompt_tokens += source.prompt_tokens;
    target.completion_tokens += source.completion_tokens;
    target.total_tokens += source.total_tokens;
  }

  /**
   * 运行 Agent
   *
   * @param userMessage    用户消息
   * @param context        对话上下文
   * @param filterOptions  工具过滤选项 —— 启用后在 AI 调用之前程序化筛选工具，省去额外的 AI 意图分析往返
   */
  async run(userMessage: string, context?: ChatMessage[], filterOptions?: ToolFilterOptions): Promise<AgentResult> {
    const state: AgentState = {
      messages: [
        { role: 'system', content: this.config.systemPrompt },
        ...(context || []),
        { role: 'user', content: userMessage },
      ],
      toolCalls: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      iterations: 0,
    };

    // 程序化工具预过滤：只把相关工具传给 AI，减少 token 消耗和误选
    let toolDefinitions: ChatToolDefinition[];
    if (filterOptions) {
      const allTools = Array.from(this.tools.values());
      const filtered = Agent.filterTools(userMessage, allTools, filterOptions);
      logger.info(`工具预过滤: ${allTools.length} -> ${filtered.length}`);
      toolDefinitions = filtered.map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    } else {
      toolDefinitions = this.getToolDefinitions();
    }
    const hasTools = toolDefinitions.length > 0;
    // O(1) 去重集合
    const seenToolKeys = new Set<string>();
    // 连续全重复计数器
    let consecutiveDuplicateRounds = 0;

    // ── 每轮压缩追踪（参考 Claude Code per-turn compression） ──
    const contextWindow = this.config.contextWindow;
    const compactTracking = contextWindow ? createAutoCompactTracking() : undefined;
    let totalMicroSaved = 0;
    let totalAutoSaved = 0;
    let compactCount = 0;

    while (state.iterations < this.config.maxIterations) {
      state.iterations++;

      // ── 每轮入口：上下文压缩 ──
      // 在调用 LLM 之前检查 token 预算，按需压缩
      if (contextWindow && compactTracking) {
        try {
          const compactResult = await autoCompactIfNeeded({
            provider: this.provider,
            messages: state.messages,
            contextWindow,
            tracking: compactTracking,
          });
          if (compactResult.wasCompacted) {
            state.messages = compactResult.messages;
            totalMicroSaved += compactResult.microSavedTokens;
            totalAutoSaved += compactResult.autoSavedTokens;
            compactCount++;
            logger.info(
              `[第${state.iterations}轮] 上下文压缩: 节省 ${compactResult.savedTokens} tokens ` +
              `(micro: ${compactResult.microSavedTokens}, auto: ${compactResult.autoSavedTokens})`,
            );
            this.emit('compaction', {
              microSavedTokens: compactResult.microSavedTokens,
              autoSavedTokens: compactResult.autoSavedTokens,
              totalTokensBefore: compactResult.savedTokens + estimateMessagesTokens(state.messages),
              totalTokensAfter: estimateMessagesTokens(state.messages),
            });
          }
        } catch (e) {
          logger.warn(`[第${state.iterations}轮] 上下文压缩失败，继续执行: ${e}`);
        }
      }

      // 强制文本回答的条件：
      // 1. 检测到连续重复工具调用
      // 2. 最后一轮迭代且已有工具结果 —— 保证 Agent 始终输出文本，不再需要额外的 summary 往返
      const isLastIteration = state.iterations >= this.config.maxIterations;
      const forceAnswer = consecutiveDuplicateRounds > 0 ||
        (isLastIteration && state.toolCalls.length > 0);

      try {
        // 工具调用轮次禁用思考（qwen3 等模型），大幅减少无效 token 生成
        const isToolCallRound = hasTools && !forceAnswer;
        const chatRequest = {
          messages: state.messages,
          tools: isToolCallRound ? toolDefinitions : undefined,
          tool_choice: isToolCallRound ? 'auto' as const : undefined,
          temperature: this.config.temperature,
          think: isToolCallRound ? false : undefined,
        };
        const { response, usedModel } = await this.chatWithFallback(chatRequest);

        Agent.addUsage(state.usage, response.usage);
        if (response.usage) {
          this.costTracker.addUsage(usedModel, response.usage);
        }
        logger.info(`token 用量: ${state.usage.prompt_tokens} -> ${state.usage.completion_tokens} -> ${state.usage.total_tokens}`);
        logger.info(`response: `,response);
        const choice = response.choices[0];
        if (!choice) break;

        // ── 分支 1: 模型想调用工具 ──
        if (choice.message.tool_calls?.length) {
          const callSummary = choice.message.tool_calls.map(
            (tc: any) => `${tc.function.name}(${tc.function.arguments})`
          ).join(', ');
          logger.info(`[第${state.iterations}轮] 工具调用: ${callSummary}`);
          this.emit('thinking', '正在执行工具调用...');

          // 当存在 tool_calls 时，content 通常是模型的内部思考或原始 JSON，
          // 不需要暴露给最终用户，但需要保留在消息历史中以维持对话完整性
          state.messages.push({
            role: 'assistant',
            content: typeof choice.message.content === 'string' ? choice.message.content : '',
            tool_calls: choice.message.tool_calls,
          });

          // 并行执行所有新工具调用，自动跳过重复
          const results = await this.executeToolCalls(
            choice.message.tool_calls,
            seenToolKeys,
            state,
          );

          if (results.length === 0) {
            consecutiveDuplicateRounds++;
            logger.warn(`[第${state.iterations}轮] 检测到重复工具调用，已跳过执行，强制下轮文本回答`);

            for (const tc of choice.message.tool_calls) {
              const key = Agent.toolCallKey(tc.function.name, tc.function.arguments);
              const previous = state.toolCalls.find(
                stc => Agent.toolCallKey(stc.tool, JSON.stringify(stc.args)) === key ||
                       Agent.toolCallKey(stc.tool, tc.function.arguments) === key,
              );
              state.messages.push({
                role: 'tool',
                content: previous ? JSON.stringify(previous.result) : 'Result received.',
                tool_call_id: tc.id,
              });
            }

            state.messages.push({
              role: 'system',
              content: 'You have all the information needed. Reply to the user in natural language; do not call more tools.',
            });

            continue;
          }

          // 有新的工具调用被执行
          consecutiveDuplicateRounds = 0;

          // 将工具结果加入消息历史
          for (const { toolCall, result } of results) {
            const resultPreview = result.length > 200 ? result.slice(0, 200) + '...' : result;
            logger.info(`[第${state.iterations}轮] 工具结果 ${toolCall.function.name}: ${resultPreview}`);
            state.messages.push({
              role: 'tool',
              content: result,
              tool_call_id: toolCall.id,
            });
          }

          // 如果工具返回的是最终结果（非查询中间步骤），引导模型直接回复
          const allSucceeded = results.every(r => !r.result.startsWith('{'));
          if (allSucceeded && results.length > 0) {
            state.messages.push({
              role: 'system',
              content: 'Tools have returned. If the information is enough to answer the user, reply in natural language; do not call the same tools again.',
            });
          }

          continue;
        }

        // ── 分支 2: 模型返回文本回答 ──
        const content = typeof choice.message.content === 'string'
          ? choice.message.content
          : '';

        const result: AgentResult = {
          content,
          toolCalls: state.toolCalls,
          usage: state.usage,
          iterations: state.iterations,
          ...(compactCount > 0 && { compaction: { microSavedTokens: totalMicroSaved, autoSavedTokens: totalAutoSaved, compactCount } }),
        };

        this.emit('complete', result);
        return result;

      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.emit('error', err);

        // ── 错误恢复策略 ──
        // 如果已经有工具结果，注入恢复消息让 AI 基于已有数据回答
        if (state.toolCalls.length > 0) {
          logger.warn(`第 ${state.iterations} 轮 LLM 调用失败，尝试基于已有数据恢复: ${err.message}`);
          const toolSummary = state.toolCalls.map(tc => {
            const r = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result);
            return `【${tc.tool}】${r}`;
          }).join('\n');
          const fallbackResult: AgentResult = {
            content: `${toolSummary}`,
            toolCalls: state.toolCalls,
            usage: state.usage,
            iterations: state.iterations,
          };
          this.emit('complete', fallbackResult);
          return fallbackResult;
        }

        // 没有任何工具结果，提供友好的错误消息
        const fallbackResult: AgentResult = {
          content: `Something went wrong: ${err.message}. Please try again or rephrase your request.`,
          toolCalls: [],
          usage: state.usage,
          iterations: state.iterations,
        };
        this.emit('complete', fallbackResult);
        return fallbackResult;
      }
    }

    // 达到最大迭代次数，基于已有工具结果生成兜底回复
    let fallbackContent: string;
    if (state.toolCalls.length > 0) {
      // 尝试从工具结果中构建有意义的回复
      const toolSummary = state.toolCalls.map(tc => {
        const r = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result);
        return `【${tc.tool}】${r}`;
      }).join('\n');
      fallbackContent = `Done. Information retrieved:\n${toolSummary}`;
    } else {
      fallbackContent = 'Max iterations reached; the task may be incomplete. Try simplifying your request and retry.';
    }

    const result: AgentResult = {
      content: fallbackContent,
      toolCalls: state.toolCalls,
      usage: state.usage,
      iterations: state.iterations,
      ...(compactCount > 0 && { compaction: { microSavedTokens: totalMicroSaved, autoSavedTokens: totalAutoSaved, compactCount } }),
    };

    this.emit('complete', result);
    return result;
  }

  /**
   * 流式运行 Agent
   *
   * @param userMessage    用户消息
   * @param context        对话上下文
   * @param filterOptions  工具过滤选项 —— 启用后在 AI 调用之前程序化筛选工具
   */
  async *runStream(userMessage: string, context?: ChatMessage[], filterOptions?: ToolFilterOptions): AsyncIterable<{
    type: 'content' | 'tool_call' | 'tool_result' | 'compaction' | 'done';
    data: any;
  }> {
    const messages: ChatMessage[] = [
      { role: 'system', content: this.config.systemPrompt },
      ...(context || []),
      { role: 'user', content: userMessage },
    ];

    // 程序化工具预过滤
    let toolDefinitions: ChatToolDefinition[];
    if (filterOptions) {
      const allTools = Array.from(this.tools.values());
      const filtered = Agent.filterTools(userMessage, allTools, filterOptions);
      logger.debug(`流式工具预过滤: ${allTools.length} -> ${filtered.length}`);
      toolDefinitions = filtered.map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    } else {
      toolDefinitions = this.getToolDefinitions();
    }
    const hasTools = toolDefinitions.length > 0;
    let iterations = 0;
    const toolCallHistory: { tool: string; args: any; result: any }[] = [];
    const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const seenToolKeys = new Set<string>();
    let consecutiveDuplicateRounds = 0;

    // ── 每轮压缩追踪 ──
    const contextWindow = this.config.contextWindow;
    const compactTracking = contextWindow ? createAutoCompactTracking() : undefined;
    let totalMicroSaved = 0;
    let totalAutoSaved = 0;
    let compactCount = 0;

    // 构建与 run() 中 executeToolCalls 兼容的轻量 state
    const state: AgentState = {
      messages,
      toolCalls: toolCallHistory,
      usage,
      iterations: 0,
    };

    while (iterations < this.config.maxIterations) {
      iterations++;
      state.iterations = iterations;

      // ── 每轮入口：上下文压缩 ──
      if (contextWindow && compactTracking) {
        try {
          const compactResult = await autoCompactIfNeeded({
            provider: this.provider,
            messages,
            contextWindow,
            tracking: compactTracking,
          });
          if (compactResult.wasCompacted) {
            // messages 是引用类型，需要原地替换
            messages.length = 0;
            messages.push(...compactResult.messages);
            totalMicroSaved += compactResult.microSavedTokens;
            totalAutoSaved += compactResult.autoSavedTokens;
            compactCount++;
            logger.info(
              `[流式第${iterations}轮] 上下文压缩: 节省 ${compactResult.savedTokens} tokens`,
            );
            const info = {
              microSavedTokens: compactResult.microSavedTokens,
              autoSavedTokens: compactResult.autoSavedTokens,
              totalTokensBefore: compactResult.savedTokens + estimateMessagesTokens(messages),
              totalTokensAfter: estimateMessagesTokens(messages),
            };
            this.emit('compaction', info);
            yield { type: 'compaction', data: info };
          }
        } catch (e) {
          logger.warn(`[流式第${iterations}轮] 上下文压缩失败，继续执行: ${e}`);
        }
      }

      let content = '';
      const pendingToolCalls: ToolCall[] = [];
      let finishReason: string | null = null;
      const isLastIteration = iterations >= this.config.maxIterations;
      const forceAnswer = consecutiveDuplicateRounds > 0 ||
        (isLastIteration && toolCallHistory.length > 0);

      // 流式获取响应
      for await (const chunk of this.provider.chatStream({
        model: this.config.model,
        messages,
        tools: hasTools && !forceAnswer ? toolDefinitions : undefined,
        tool_choice: hasTools && !forceAnswer ? 'auto' : undefined,
        temperature: this.config.temperature,
      })) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        // 处理内容片段
        if (choice.delta.content) {
          content += choice.delta.content;
          // 仅在非工具调用阶段输出内容给消费者
          if (pendingToolCalls.length === 0) {
            yield { type: 'content', data: choice.delta.content };
          }
        }

        // 合并工具调用片段
        if (choice.delta.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            let existing = pendingToolCalls.find(p => p.id === tc.id);
            if (!existing && tc.id) {
              existing = {
                id: tc.id,
                type: 'function',
                function: { name: '', arguments: '' },
              };
              pendingToolCalls.push(existing);
            }
            if (existing && tc.function) {
              if (tc.function.name) existing.function.name += tc.function.name;
              if (tc.function.arguments) existing.function.arguments += tc.function.arguments;
            }
          }
        }

        if (choice.finish_reason) finishReason = choice.finish_reason;

        Agent.addUsage(usage, chunk.usage);
        if (chunk.usage) {
          this.costTracker.addUsage(this.config.model, chunk.usage);
        }
      }

      // 将 assistant 消息加入上下文
      messages.push({
        role: 'assistant',
        content,
        tool_calls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
      });

      // 处理工具调用
      if (pendingToolCalls.length > 0 && finishReason === 'tool_calls') {
        // 先通知上层所有工具调用开始
        for (const tc of pendingToolCalls) {
          const key = Agent.toolCallKey(tc.function.name, tc.function.arguments);
          if (!seenToolKeys.has(key)) {
            yield { type: 'tool_call', data: { name: tc.function.name, args: tc.function.arguments } };
          }
        }

        // 使用统一的 executeToolCalls（含读写并发控制 + 去重）
        const results = await this.executeToolCalls(pendingToolCalls, seenToolKeys, state);

        if (results.length === 0) {
          // 全部重复
          consecutiveDuplicateRounds++;

          for (const tc of pendingToolCalls) {
            const key = Agent.toolCallKey(tc.function.name, tc.function.arguments);
            const previous = toolCallHistory.find(
              h => Agent.toolCallKey(h.tool, JSON.stringify(h.args)) === key ||
                   Agent.toolCallKey(h.tool, tc.function.arguments) === key,
            );
            messages.push({
              role: 'tool',
              content: previous ? JSON.stringify(previous.result) : 'Result received.',
              tool_call_id: tc.id,
            });
          }
          continue;
        }

        consecutiveDuplicateRounds = 0;

        // yield 工具结果并加入消息历史
        for (const { toolCall, result } of results) {
          yield { type: 'tool_result', data: { name: toolCall.function.name, result } };
          messages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          });
        }

        // 为重复的调用也补上 tool 消息（已被 executeToolCalls 过滤掉的）
        for (const tc of pendingToolCalls) {
          const key = Agent.toolCallKey(tc.function.name, tc.function.arguments);
          const wasExecuted = results.some(r => r.toolCall.id === tc.id);
          if (!wasExecuted) {
            const previous = toolCallHistory.find(
              h => Agent.toolCallKey(h.tool, JSON.stringify(h.args)) === key ||
                   Agent.toolCallKey(h.tool, tc.function.arguments) === key,
            );
            messages.push({
              role: 'tool',
              content: previous ? JSON.stringify(previous.result) : 'Result received.',
              tool_call_id: tc.id,
            });
          }
        }

        continue;
      }

      // 完成
      yield {
        type: 'done',
        data: {
          content,
          toolCalls: toolCallHistory,
          usage,
          iterations,
          ...(compactCount > 0 && { compaction: { microSavedTokens: totalMicroSaved, autoSavedTokens: totalAutoSaved, compactCount } }),
        },
      };
      return;
    }

    // 达到最大迭代次数
    yield {
      type: 'done',
      data: {
        content: toolCallHistory.length > 0
          ? `Done. Executed ${toolCallHistory.length} tool call(s).`
          : 'Max iterations reached.',
        toolCalls: toolCallHistory,
        usage,
        iterations,
        ...(compactCount > 0 && { compaction: { microSavedTokens: totalMicroSaved, autoSavedTokens: totalAutoSaved, compactCount } }),
      },
    };
  }
}

/**
 * 创建 Agent 实例
 */
export function createAgent(provider: AIProvider, config: Omit<AgentConfig, 'provider'>): Agent {
  return new Agent(provider, {
    ...config,
    provider: provider.name,
  });
}
