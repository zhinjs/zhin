/**
 * Agent 模块测试环境设置
 * 提供 Mock 与测试辅助，类型与规范从 @zhin.js/core 引用
 */
import { vi } from 'vitest';
import type { Message, MessageElement, Tool, ToolContext } from '@zhin.js/core';
import type { AIConfig, ChatMessage } from '@zhin.js/core';

export const createMockLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

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

export const createToolContext = (options: Partial<ToolContext> = {}): ToolContext => ({
  platform: 'test',
  scope: 'group',
  permissionLevel: 'user',
  ...options,
});

export const createMockAIConfig = (overrides: Partial<AIConfig> = {}): AIConfig => ({
  defaultProvider: 'mock',
  sessions: {
    maxHistory: 10,
    expireMs: 300000,
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

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const createChatMessage = (
  role: 'user' | 'assistant' | 'system',
  content: string
): ChatMessage => ({
  role,
  content,
});

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
