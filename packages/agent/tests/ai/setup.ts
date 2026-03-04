/**
 * Agent 模块测试环境设置
 * 提供 Mock 与测试辅助，类型与规范从 @zhin.js/core 引用
 * 通用 AI mocks 从 @zhin.js/ai 测试 setup 导入
 */
import { vi } from 'vitest';
import type { Message, MessageElement, Tool, ToolContext } from '@zhin.js/core';
import type { AIConfig } from '@zhin.js/core';

// Import and re-export generic AI mocks from ai package tests
import {
  createMockLogger,
  createMockProvider,
  createChatMessage,
  delay,
  waitFor,
  collectAsyncGenerator,
} from '../../../ai/tests/setup.js';
export {
  createMockLogger,
  createMockProvider,
  createChatMessage,
  delay,
  waitFor,
  collectAsyncGenerator,
};

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
