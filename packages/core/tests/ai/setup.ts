/**
 * AI 模块测试环境设置
 * 
 * 提供：
 * - Mock 对象工厂
 * - 测试辅助函数
 * - 公共测试配置
 */
import { vi } from 'vitest';
import type { Message, MessageElement, Tool, ToolContext } from '@zhin.js/core';
import type { AIConfig, AIProviderConfig, ChatMessage } from '../../src/ai/types.js';

// ============================================================================
// Logger Mock
// ============================================================================

export const createMockLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// ============================================================================
// Plugin Mock
// ============================================================================

export const createMockPlugin = (name = 'test-plugin') => ({
  name,
  root: {
    inject: vi.fn(),
    contexts: new Map(),
    middleware: vi.fn(),
  },
  logger: createMockLogger(),
  onDispose: vi.fn(),
  collectAllTools: vi.fn(() => []),
  provide: vi.fn(),
  useContext: vi.fn(),
  addMiddleware: vi.fn(),
});

// ============================================================================
// Message Mock
// ============================================================================

export interface MockMessageOptions {
  content?: string;
  elements?: MessageElement[];
  platform?: string;
  channelType?: 'group' | 'private' | 'guild';
  channelId?: string;
  senderId?: string;
  senderPermissions?: string[];
  senderRole?: string;
  botId?: string;
}

export const createMockMessage = (options: MockMessageOptions = {}): Partial<Message> => {
  const {
    content = '测试消息',
    elements,
    platform = 'test',
    channelType = 'group',
    channelId = 'channel-1',
    senderId = 'user-1',
    senderPermissions = [],
    senderRole,
    botId = 'bot-1',
  } = options;

  const $content: MessageElement[] = elements || [
    { type: 'text', data: { text: content } },
  ];

  return {
    $content,
    $bot: botId,
    $adapter: platform,
    $channel: {
      type: channelType,
      id: channelId,
      name: 'Test Channel',
    },
    $sender: {
      id: senderId,
      name: 'Test User',
      permissions: senderPermissions,
      role: senderRole,
    },
    $reply: vi.fn().mockResolvedValue(undefined),
    $quote: vi.fn().mockResolvedValue(undefined),
  };
};

// ============================================================================
// Tool Mock
// ============================================================================

export interface MockToolOptions {
  name: string;
  description?: string;
  parameters?: Record<string, { type: string; description?: string }>;
  required?: string[];
  platforms?: string[];
  scopes?: ('group' | 'private' | 'guild')[];
  permissionLevel?: 'user' | 'group_admin' | 'group_owner' | 'bot_admin' | 'owner';
  tags?: string[];
  keywords?: string[];
  executeResult?: any;
  executeError?: Error;
}

export const createMockTool = (options: MockToolOptions): Tool => {
  const {
    name,
    description = `${name} 工具`,
    parameters = {},
    required = [],
    platforms,
    scopes,
    permissionLevel,
    tags = [],
    keywords = [],
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
    platforms,
    scopes,
    permissionLevel,
    tags,
    execute: executeError
      ? vi.fn().mockRejectedValue(executeError)
      : vi.fn().mockResolvedValue(executeResult),
  };
  if (keywords.length > 0) tool.keywords = keywords;
  return tool;
};

// ============================================================================
// AI Provider Mock
// ============================================================================

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
      chat: vi.fn().mockRejectedValue(error),
      healthCheck: vi.fn().mockResolvedValue(false),
    };
  }

  const generateResponse = async function* (): AsyncGenerator<{
    content?: string;
    toolCalls?: Array<{ name: string; arguments: Record<string, any> }>;
    done: boolean;
  }> {
    if (toolCalls.length > 0) {
      yield { toolCalls, done: false };
    }
    
    if (typeof response === 'string') {
      yield { content: response, done: true };
    } else {
      for await (const chunk of response) {
        yield { content: chunk, done: false };
      }
      yield { done: true };
    }
  };

  return {
    name,
    chat: vi.fn().mockImplementation(() => generateResponse()),
    healthCheck: vi.fn().mockResolvedValue(true),
  };
};

// ============================================================================
// Context Factory
// ============================================================================

export const createToolContext = (options: Partial<ToolContext> = {}): ToolContext => ({
  platform: 'test',
  scope: 'group',
  permissionLevel: 'user',
  ...options,
});

// ============================================================================
// AI Config Factory
// ============================================================================

export const createMockAIConfig = (overrides: Partial<AIConfig> = {}): AIConfig => ({
  defaultProvider: 'mock',
  sessions: {
    maxHistory: 10,
    timeout: 300000,
  },
  context: {
    enabled: false,
    maxSize: 100,
  },
  trigger: {
    enabled: true,
    prefixes: ['#'],
    ignorePrefixes: ['/'],
    allowAtBot: true,
    allowPrivateChat: true,
  },
  ...overrides,
});

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * 等待 Promise 解决或超时
 */
export const waitFor = async <T>(
  promise: Promise<T>,
  timeout = 5000
): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeout)
    ),
  ]);
};

/**
 * 收集 AsyncGenerator 的所有值
 */
export const collectAsyncGenerator = async <T>(
  generator: AsyncGenerator<T>
): Promise<T[]> => {
  const results: T[] = [];
  for await (const item of generator) {
    results.push(item);
  }
  return results;
};

/**
 * 创建延迟 Promise
 */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 创建带有所有字段的 ChatMessage
 */
export const createChatMessage = (
  role: 'user' | 'assistant' | 'system',
  content: string
): ChatMessage => ({
  role,
  content,
});

/**
 * 验证工具参数结构
 */
export const assertToolParameters = (
  tool: Tool,
  expectedProperties: string[],
  expectedRequired: string[] = []
) => {
  const props = Object.keys(tool.parameters.properties || {});
  expect(props).toEqual(expect.arrayContaining(expectedProperties));
  
  if (expectedRequired.length > 0) {
    expect(tool.parameters.required).toEqual(expect.arrayContaining(expectedRequired));
  }
};
