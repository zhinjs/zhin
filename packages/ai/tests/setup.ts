/**
 * @zhin.js/ai 测试环境设置
 * 提供通用 AI Mock 与测试辅助
 */
import { vi } from 'vitest';
import type { ChatMessage, AgentTool } from '@zhin.js/ai';

export const createMockLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

export interface MockProviderOptions {
  name?: string;
  response?: string | AsyncGenerator<string>;
  toolCalls?: Array<{ name: string; arguments: Record<string, any> }>;
  error?: Error;
}

export const createMockProvider = (options: MockProviderOptions = {}) => {
  const {
    name = 'mock',
    response = '这是 AI 的回复',
    toolCalls = [],
    error,
  } = options;

  if (error) {
    return {
      name,
      models: ['mock-model'],
      chat: vi.fn().mockRejectedValue(error),
      healthCheck: vi.fn().mockResolvedValue(false),
    };
  }

  return {
    name,
    models: ['mock-model'],
    chat: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
  };
};

/** 构建 ChatCompletionResponse 用于测试 */
export const createChatResponse = (content: string, toolCalls?: any[]) => ({
  id: 'test-id',
  object: 'chat.completion',
  created: Date.now(),
  model: 'mock-model',
  choices: [{
    index: 0,
    message: {
      role: 'assistant',
      content,
      tool_calls: toolCalls,
    },
    finish_reason: toolCalls ? 'tool_calls' : 'stop',
  }],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 10,
    total_tokens: 20,
  },
});

export const createChatMessage = (
  role: 'user' | 'assistant' | 'system',
  content: string
): ChatMessage => ({
  role,
  content,
});

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const waitFor = async <T>(promise: Promise<T>, timeout = 5000): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeout)
    ),
  ]);
};

export const collectAsyncGenerator = async <T>(generator: AsyncGenerator<T>): Promise<T[]> => {
  const results: T[] = [];
  for await (const item of generator) {
    results.push(item);
  }
  return results;
};

export interface MockToolOptions {
  name: string;
  description?: string;
  parameters?: Record<string, { type: string; description?: string }>;
  required?: string[];
  tags?: string[];
  keywords?: string[];
  permissionLevel?: number;
  executeResult?: any;
  executeError?: Error;
}

export const createMockTool = (options: MockToolOptions): AgentTool => {
  const {
    name,
    description = `${name} 工具`,
    parameters = {},
    required = [],
    tags = [],
    keywords = [],
    permissionLevel,
    executeResult = 'success',
    executeError,
  } = options;

  const properties: Record<string, any> = {};
  for (const [key, value] of Object.entries(parameters)) {
    properties[key] = {
      type: value.type,
      description: value.description,
    };
  }

  const tool: any = {
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required,
    },
    tags,
    keywords,
    permissionLevel,
    execute: executeError
      ? vi.fn().mockRejectedValue(executeError)
      : vi.fn().mockResolvedValue(executeResult),
  };
  return tool;
};
