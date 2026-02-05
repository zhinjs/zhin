/**
 * @zhin.js/ai - Agent System
 * AI Agent 实现，支持工具调用和多轮对话
 */

import { Logger } from '@zhin.js/core';
import type {
  AIProvider,
  AgentConfig,
  AgentTool,
  AgentResult,
  ChatMessage,
  ToolDefinition,
  ToolCall,
  Usage,
} from './types.js';

const logger = new Logger(null, 'Agent');

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
   * 获取工具定义
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
   * 执行工具调用
   */
  private async executeToolCall(toolCall: ToolCall): Promise<string> {
    const tool = this.tools.get(toolCall.function.name);
    if (!tool) {
      return JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` });
    }

    try {
      const args = JSON.parse(toolCall.function.arguments);
      this.emit('tool_call', tool.name, args);
      
      const result = await tool.execute(args);
      this.emit('tool_result', tool.name, result);
      
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ error: errorMsg });
    }
  }

  /**
   * 运行 Agent
   */
  async run(userMessage: string, context?: ChatMessage[]): Promise<AgentResult> {
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

    const toolDefinitions = this.getToolDefinitions();

    while (state.iterations < this.config.maxIterations) {
      state.iterations++;

      try {
        const response = await this.provider.chat({
          model: this.config.model,
          messages: state.messages,
          tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
          tool_choice: toolDefinitions.length > 0 ? 'auto' : undefined,
          temperature: this.config.temperature,
        });

        // 更新用量
        if (response.usage) {
          state.usage.prompt_tokens += response.usage.prompt_tokens;
          state.usage.completion_tokens += response.usage.completion_tokens;
          state.usage.total_tokens += response.usage.total_tokens;
        }

        const choice = response.choices[0];
        if (!choice) break;

        // 如果包含工具调用，不立即将模型原始内容暴露给上层
        if (choice.message.tool_calls?.length) {
          this.emit('thinking', '正在执行工具调用...');

          // 将 assistant 消息加入会话上下文，但避免直接展示纯 JSON 的工具调用原始内容
          let assistantContent = '';
          if (typeof choice.message.content === 'string' && choice.message.content) {
            const rawContent = choice.message.content;
            const trimmed = rawContent.trim();
            // 如果内容整体看起来是 JSON（常见于模型将工具调用以 JSON 形式返回），则不暴露给上层
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
              try {
                JSON.parse(trimmed);
                // 解析成功，说明是纯 JSON；保持 assistantContent 为空字符串
              } catch {
                // 解析失败，当作普通文本保留
                assistantContent = rawContent;
              }
            } else {
              // 非纯 JSON 内容，直接保留
              assistantContent = rawContent;
            }
          }

          state.messages.push({
            role: 'assistant',
            content: assistantContent,
            tool_calls: choice.message.tool_calls,
          });

          // 检测重复工具调用
          let hasDuplicateCall = false;
          for (const toolCall of choice.message.tool_calls) {
            const toolName = toolCall.function.name;
            const toolArgs = toolCall.function.arguments;
            
            // 检查是否重复调用相同工具（相同名称和参数）
            const isDuplicate = state.toolCalls.some(
              tc => tc.tool === toolName && JSON.stringify(tc.args) === toolArgs
            );
            
            if (isDuplicate) {
              logger.debug(`重复工具调用: ${toolName}，跳过`);
              hasDuplicateCall = true;
              continue;
            }
            
            const result = await this.executeToolCall(toolCall);
            
            // 尝试解析 JSON，如果失败则使用原始字符串
            let parsedResult: any;
            try {
              parsedResult = JSON.parse(result);
            } catch {
              parsedResult = result;
            }
            
            state.toolCalls.push({
              tool: toolName,
              args: JSON.parse(toolArgs),
              result: parsedResult,
            });

            // 添加工具结果消息（供模型下一步使用）
            state.messages.push({
              role: 'tool',
              content: result,
              tool_call_id: toolCall.id,
            });
          }

          // 如果所有调用都是重复的，强制模型生成最终回答
          if (hasDuplicateCall && choice.message.tool_calls.every(tc => 
            state.toolCalls.some(stc => stc.tool === tc.function.name && JSON.stringify(stc.args) === tc.function.arguments)
          )) {
            // 添加提示让模型总结结果
            state.messages.push({
              role: 'user',
              content: '请根据已获取的工具结果，用中文总结回答我的问题。',
            });
          }

          // 继续循环，让模型处理工具结果并生成最终回答
          continue;
        }

        // 没有工具调用，返回结果
        let content = typeof choice.message.content === 'string'
          ? choice.message.content
          : '';

        // 如果内容为空但有工具调用结果，生成基于工具结果的回复
        if (!content.trim() && state.toolCalls.length > 0) {
          const lastToolCall = state.toolCalls[state.toolCalls.length - 1];
          const resultStr = typeof lastToolCall.result === 'string' 
            ? lastToolCall.result 
            : JSON.stringify(lastToolCall.result, null, 2);
          content = `根据查询结果:\n\n${resultStr}`;
        }

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
        throw err;
      }
    }

    // 达到最大迭代次数
    const result: AgentResult = {
      content: '达到最大迭代次数，任务可能未完成。',
      toolCalls: state.toolCalls,
      usage: state.usage,
      iterations: state.iterations,
    };

    this.emit('complete', result);
    return result;
  }

  /**
   * 流式运行 Agent
   */
  async *runStream(userMessage: string, context?: ChatMessage[]): AsyncIterable<{
    type: 'content' | 'tool_call' | 'tool_result' | 'done';
    data: any;
  }> {
    const messages: ChatMessage[] = [
      { role: 'system', content: this.config.systemPrompt },
      ...(context || []),
      { role: 'user', content: userMessage },
    ];

    const toolDefinitions = this.getToolDefinitions();
    let iterations = 0;
    const toolCallHistory: { tool: string; args: any; result: any }[] = [];
    const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    while (iterations < this.config.maxIterations) {
      iterations++;

      let content = '';
      const pendingToolCalls: ToolCall[] = [];
      let finishReason: string | null = null;

      // 流式获取响应
      for await (const chunk of this.provider.chatStream({
        model: this.config.model,
        messages,
        tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
        tool_choice: toolDefinitions.length > 0 ? 'auto' : undefined,
        temperature: this.config.temperature,
      })) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        // 处理内容
        if (choice.delta.content) {
          content += choice.delta.content;
          yield { type: 'content', data: choice.delta.content };
        }

        // 处理工具调用
        if (choice.delta.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            // 合并工具调用片段
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

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        if (chunk.usage) {
          usage.prompt_tokens += chunk.usage.prompt_tokens;
          usage.completion_tokens += chunk.usage.completion_tokens;
          usage.total_tokens += chunk.usage.total_tokens;
        }
      }

      // 添加 assistant 消息。若存在 pendingToolCalls，则不要在流式期间把模型原始包含工具调用的内容直接发送给消费者。
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content,
        tool_calls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
      };
      messages.push(assistantMessage);

      // 处理工具调用（流式模式）
      if (pendingToolCalls.length > 0 && finishReason === 'tool_calls') {
        for (const toolCall of pendingToolCalls) {
          // 通知上层开始执行工具（上层可用于显示“正在执行工具”而非工具原始内容）
          yield { type: 'tool_call', data: { name: toolCall.function.name, args: toolCall.function.arguments } };

          const result = await this.executeToolCall(toolCall);

          toolCallHistory.push({
            tool: toolCall.function.name,
            args: JSON.parse(toolCall.function.arguments),
            result: JSON.parse(result),
          });

          // 返回工具结果（上层可选择把工具执行过程隐藏，仅在最终完成时展示润色结果）
          yield { type: 'tool_result', data: { name: toolCall.function.name, result } };

          messages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          });
        }

        // 继续循环，让模型以工具结果为上下文生成最终回答
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
        content: '达到最大迭代次数',
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
