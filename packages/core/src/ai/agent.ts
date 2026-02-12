/**
 * @zhin.js/ai - Agent System
 * AI Agent 实现，支持工具调用和多轮对话
 */

import { Logger } from '@zhin.js/logger';
import type {
  AIProvider,
  AgentConfig,
  AgentTool,
  AgentResult,
  ChatMessage,
  ToolDefinition,
  ToolCall,
  ToolFilterOptions,
  Usage,
} from './types.js';

const logger = new Logger(null, 'Agent');

/** 工具执行默认超时时间 (ms) */
const DEFAULT_TOOL_TIMEOUT = 30_000;

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
}

/**
 * AI Agent 类
 * 支持工具调用、多轮对话、流式输出
 */
export class Agent {
  private provider: AIProvider;
  private config: Required<AgentConfig>;
  private tools: Map<string, AgentTool> = new Map();
  private eventHandlers: Map<keyof AgentEvents, Function[]> = new Map();

  constructor(provider: AIProvider, config: AgentConfig) {
    this.provider = provider;
    this.config = {
      provider: config.provider,
      model: config.model || provider.models[0],
      systemPrompt: config.systemPrompt || this.getDefaultSystemPrompt(),
      tools: config.tools || [],
      maxIterations: config.maxIterations || 10,
      temperature: config.temperature ?? 0.7,
    };

    // 注册工具
    for (const tool of this.config.tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * 默认系统提示词
   */
  private getDefaultSystemPrompt(): string {
    return `你是一个智能助手，可以使用工具来帮助用户完成任务。
请遵循以下原则：
1. 理解用户的意图，选择合适的工具
2. 如果需要多个步骤，逐步执行
3. 清晰地解释你的行动和结果
4. 如果无法完成任务，诚实地告知用户`;
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
  private getToolDefinitions(): ToolDefinition[] {
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
   * 生成工具调用的去重 key
   */
  private static toolCallKey(name: string, args: string): string {
    return `${name}::${args}`;
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
   * 程序化工具过滤 —— 替代 AI 意图分析的高效方案
   *
   * 评分规则（按权重从高到低）：
   * 1. keywords 精确匹配: +1.0 per hit   —— 工具声明的触发关键词
   * 2. tags 匹配:          +0.5 per hit   —— 工具分类标签
   * 3. 工具名 token 匹配:  +0.3 per hit   —— 工具名按 `.` `_` `-` 拆词
   * 4. description 关键词:  +0.15 per hit  —— 描述中的词/短语
   *
   * 权限过滤发生在评分之前，直接跳过无权使用的工具。
   *
   * @param message      用户消息原文
   * @param tools        候选工具列表
   * @param options      过滤选项
   * @returns            按相关性降序排列的工具子集
   */
  static filterTools(
    message: string,
    tools: AgentTool[],
    options?: ToolFilterOptions,
  ): AgentTool[] {
    if (tools.length === 0) return [];

    const maxTools = options?.maxTools ?? 10;
    const minScore = options?.minScore ?? 0.1;
    const callerPerm = options?.callerPermissionLevel ?? Infinity;

    const msgLower = message.toLowerCase();

    const scored: { tool: AgentTool; score: number }[] = [];

    for (const tool of tools) {
      // ── 权限过滤 ──
      if (tool.permissionLevel != null && tool.permissionLevel > callerPerm) {
        continue;
      }

      let score = 0;

      // ── 1. keywords 匹配（最高权重） ──
      if (tool.keywords?.length) {
        for (const kw of tool.keywords) {
          if (kw && msgLower.includes(kw.toLowerCase())) {
            score += 1.0;
          }
        }
      }

      // ── 2. tags 匹配 ──
      if (tool.tags?.length) {
        for (const tag of tool.tags) {
          if (tag && tag.length > 1 && msgLower.includes(tag.toLowerCase())) {
            score += 0.5;
          }
        }
      }

      // ── 3. 工具名 token 匹配 ──
      const nameTokens = tool.name.toLowerCase().split(/[._\-]+/);
      for (const nt of nameTokens) {
        if (nt.length > 1 && msgLower.includes(nt)) {
          score += 0.3;
        }
      }

      // ── 4. 描述双向匹配（对中文友好） ──
      // 4a. 描述词 → 出现在用户消息中？
      const descLower = tool.description.toLowerCase();
      const descWords = descLower
        .split(/[\s,.:;!?，。：；！？、()（）【】\[\]]+/)
        .filter(w => w.length >= 2);
      for (const dw of descWords) {
        if (msgLower.includes(dw)) {
          score += 0.15;
        }
      }
      // 4b. 用户消息词 → 出现在描述中？（中文无空格分词，逆向补偿）
      const msgWords = msgLower
        .split(/[\s,.:;!?，。：；！？、()（）【】\[\]]+/)
        .filter(w => w.length >= 2);
      for (const mw of msgWords) {
        if (descLower.includes(mw)) {
          score += 0.2;
        }
      }

      if (score >= minScore) {
        scored.push({ tool, score });
      }
    }

    // 按分数降序
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, maxTools).map(s => s.tool);
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

    try {
      const args = JSON.parse(toolCall.function.arguments);
      this.emit('tool_call', tool.name, args);

      // 带超时的工具执行
      const result = await Promise.race([
        tool.execute(args),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`工具 ${tool.name} 执行超时`)), DEFAULT_TOOL_TIMEOUT),
        ),
      ]);

      this.emit('tool_result', tool.name, result);
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`工具 ${toolCall.function.name} 执行失败: ${errorMsg}`);
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

    // 并行执行所有新工具调用
    const tasks = fresh.map(async (tc) => {
      const result = await this.executeToolCall(tc);
      const args = Agent.safeParse(tc.function.arguments);
      const parsedResult = Agent.safeParse(result);

      // 记录到状态
      const key = Agent.toolCallKey(tc.function.name, tc.function.arguments);
      seenKeys.add(key);
      state.toolCalls.push({
        tool: tc.function.name,
        args: typeof args === 'object' ? args : { raw: args },
        result: parsedResult,
      });

      return { toolCall: tc, result, args };
    });

    return Promise.all(tasks);
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
    let toolDefinitions: ToolDefinition[];
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

    while (state.iterations < this.config.maxIterations) {
      state.iterations++;

      // 强制文本回答的条件：
      // 1. 检测到连续重复工具调用
      // 2. 最后一轮迭代且已有工具结果 —— 保证 Agent 始终输出文本，不再需要额外的 summary 往返
      const isLastIteration = state.iterations >= this.config.maxIterations;
      const forceAnswer = consecutiveDuplicateRounds > 0 ||
        (isLastIteration && state.toolCalls.length > 0);

      try {
        // 工具调用轮次禁用思考（qwen3 等模型），大幅减少无效 token 生成
        const isToolCallRound = hasTools && !forceAnswer;
        const response = await this.provider.chat({
          model: this.config.model,
          messages: state.messages,
          tools: isToolCallRound ? toolDefinitions : undefined,
          tool_choice: isToolCallRound ? 'auto' : undefined,
          temperature: this.config.temperature,
          think: isToolCallRound ? false : undefined,
        });

        Agent.addUsage(state.usage, response.usage);
        logger.info(`token 用量: ${state.usage.prompt_tokens} -> ${state.usage.completion_tokens} -> ${state.usage.total_tokens}`);
        logger.info(`response: `,response);
        const choice = response.choices[0];
        if (!choice) break;

        // ── 分支 1: 模型想调用工具 ──
        if (choice.message.tool_calls?.length) {
          this.emit('thinking', '正在执行工具调用...');

          // 当存在 tool_calls 时，content 通常是模型的内部思考或原始 JSON，
          // 不需要暴露给最终用户，但需要保留在消息历史中以维持对话完整性
          state.messages.push({
            role: 'tool_call',
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
            // 本轮全部重复
            consecutiveDuplicateRounds++;

            // 为每个重复的 tool_call 补上 tool 消息，保持协议完整性
            for (const tc of choice.message.tool_calls) {
              const key = Agent.toolCallKey(tc.function.name, tc.function.arguments);
              const previous = state.toolCalls.find(
                stc => Agent.toolCallKey(stc.tool, JSON.stringify(stc.args)) === key ||
                       Agent.toolCallKey(stc.tool, tc.function.arguments) === key,
              );
              state.messages.push({
                role: 'tool',
                content: previous ? JSON.stringify(previous.result) : '结果已获取',
                tool_call_id: tc.id,
              });
            }

            // 下一轮将 forceAnswer=true，通过不传 tools 参数来禁止工具调用
            continue;
          }

          // 有新的工具调用被执行
          consecutiveDuplicateRounds = 0;

          // 将工具结果加入消息历史
          for (const { toolCall, result } of results) {
            state.messages.push({
              role: 'tool',
              content: result,
              tool_call_id: toolCall.id,
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
            content: `以下是已获取的工具结果：\n${toolSummary}`,
            toolCalls: state.toolCalls,
            usage: state.usage,
            iterations: state.iterations,
          };
          this.emit('complete', fallbackResult);
          return fallbackResult;
        }

        // 没有任何工具结果，提供友好的错误消息
        const fallbackResult: AgentResult = {
          content: `抱歉，处理过程中遇到了问题：${err.message}。请稍后重试或换个方式提问。`,
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
      fallbackContent = `处理完成，以下是获取到的信息：\n${toolSummary}`;
    } else {
      fallbackContent = '达到最大处理轮次，任务可能未完全完成。请尝试简化问题后重试。';
    }

    const result: AgentResult = {
      content: fallbackContent,
      toolCalls: state.toolCalls,
      usage: state.usage,
      iterations: state.iterations,
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
    type: 'content' | 'tool_call' | 'tool_result' | 'done';
    data: any;
  }> {
    const messages: ChatMessage[] = [
      { role: 'system', content: this.config.systemPrompt },
      ...(context || []),
      { role: 'user', content: userMessage },
    ];

    // 程序化工具预过滤
    let toolDefinitions: ToolDefinition[];
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

    while (iterations < this.config.maxIterations) {
      iterations++;

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
      }

      // 将 assistant 消息加入上下文
      messages.push({
        role: 'tool_call',
        content,
        tool_calls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
      });

      // 处理工具调用
      if (pendingToolCalls.length > 0 && finishReason === 'tool_calls') {
        // 分离新调用和重复调用
        const freshCalls: ToolCall[] = [];
        const duplicateCalls: ToolCall[] = [];

        for (const tc of pendingToolCalls) {
          const key = Agent.toolCallKey(tc.function.name, tc.function.arguments);
          if (seenToolKeys.has(key)) {
            duplicateCalls.push(tc);
          } else {
            freshCalls.push(tc);
          }
        }

        if (freshCalls.length === 0) {
          // 全部重复
          consecutiveDuplicateRounds++;

          // 补上 tool 消息保持协议完整
          for (const tc of pendingToolCalls) {
            const key = Agent.toolCallKey(tc.function.name, tc.function.arguments);
            const previous = toolCallHistory.find(
              h => Agent.toolCallKey(h.tool, JSON.stringify(h.args)) === key ||
                   Agent.toolCallKey(h.tool, tc.function.arguments) === key,
            );
            messages.push({
              role: 'tool_result',
              content: previous ? JSON.stringify(previous.result) : '结果已获取',
              tool_call_id: tc.id,
            });
          }
          continue;
        }

        consecutiveDuplicateRounds = 0;

        // 先通知上层所有工具调用开始
        for (const tc of freshCalls) {
          yield { type: 'tool_call', data: { name: tc.function.name, args: tc.function.arguments } };
        }

        // 并行执行所有新工具调用
        const results = await Promise.all(
          freshCalls.map(async (toolCall) => {
            const result = await this.executeToolCall(toolCall);
            const args = Agent.safeParse(toolCall.function.arguments);
            const parsedResult = Agent.safeParse(result);

            const key = Agent.toolCallKey(toolCall.function.name, toolCall.function.arguments);
            seenToolKeys.add(key);
            toolCallHistory.push({
              tool: toolCall.function.name,
              args: typeof args === 'object' ? args : { raw: args },
              result: parsedResult,
            });

            return { toolCall, result };
          }),
        );

        // yield 工具结果并加入消息历史
        for (const { toolCall, result } of results) {
          yield { type: 'tool_result', data: { name: toolCall.function.name, result } };
          messages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          });
        }

        // 为重复的调用也补上 tool 消息
        for (const tc of duplicateCalls) {
          const key = Agent.toolCallKey(tc.function.name, tc.function.arguments);
          const previous = toolCallHistory.find(
            h => Agent.toolCallKey(h.tool, JSON.stringify(h.args)) === key ||
                 Agent.toolCallKey(h.tool, tc.function.arguments) === key,
          );
          messages.push({
            role: 'tool',
            content: previous ? JSON.stringify(previous.result) : '结果已获取',
            tool_call_id: tc.id,
          });
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
        },
      };
      return;
    }

    // 达到最大迭代次数
    yield {
      type: 'done',
      data: {
        content: toolCallHistory.length > 0
          ? `处理完成，共执行了 ${toolCallHistory.length} 个工具调用。`
          : '达到最大迭代次数',
        toolCalls: toolCallHistory,
        usage,
        iterations,
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
