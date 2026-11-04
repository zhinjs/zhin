/**
 * AI 模块集成测试
 * 
 * 完整测试环境，包括：
 * 1. AI 服务初始化
 * 2. 工具服务功能
 * 3. AI 触发中间件
 * 4. 显式工具注册
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Logger first
vi.mock('@zhin.js/core', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    Logger: class {
      debug = vi.fn();
      info = vi.fn();
      warn = vi.fn();
      error = vi.fn();
    },
    segment: {
      toString: (elements: any[]) => {
        if (!Array.isArray(elements)) return String(elements);
        return elements.map(el => {
          if (typeof el === 'string') return el;
          if (el.type === 'text') return el.data?.text || '';
          if (el.type === 'at') return `<at user_id="${el.data?.user_id || el.data?.qq}"/>`;
          if (el.type === 'image') return `<image url="${el.data?.url}"/>`;
          return '';
        }).join('');
      },
      from: (str: string) => {
        if (!str) return [];
        return [{ type: 'text', data: { text: str } }];
      },
    },
  };
});

// Import after mocking — AIService from agent; Tool/trigger contracts from core
import { AIService } from '@zhin.js/agent';
import { executionBundle, executionScope } from '../helpers/execution-bundle.js';
import { assistantTextReply } from '../helpers/mock-llm-api.js';
import { shouldTriggerAI, resolveSenderRoles, type AgentTool } from '@zhin.js/core';

// ============================================================================
// AI Service 测试
// ============================================================================

describe('AI Service 集成测试', () => {
  let aiService: AIService;

  beforeEach(() => {
    vi.clearAllMocks();
    aiService = new AIService({
      sessions: { maxHistory: 10 },
    });
  });

  afterEach(async () => {
    await aiService?.dispose();
  });

  describe('服务初始化', () => {
    it('应该创建 AI 服务实例', () => {
      expect(aiService).toBeDefined();
      expect(aiService.getBindingRegistry()).toBeDefined();
    });

    it('starts without any model authority and requires explicit Host preparation', () => {
      expect(aiService.isReady()).toBe(false);
      expect(() => aiService.getModelRuntime()).toThrow('not prepared');
      expect(aiService).not.toHaveProperty('getProvider');
      expect(aiService).not.toHaveProperty('listProviders');
    });

    it.each(['providers', 'modelCatalog', 'modelPolicy', 'defaultProvider'])('rejects old %s authority rather than constructing a parallel runtime', key => {
      expect(() => new AIService({ [key]: {} })).toThrow('migration required');
    });
  });

  describe('配置管理', () => {
    it('应该返回上下文配置', () => {
      const config = aiService.getContextConfig();
      expect(config).toBeDefined();
    });

    it('应该返回触发器配置', () => {
      const config = aiService.getTriggerConfig();
      expect(config).toBeDefined();
    });

    it('应该返回 access 配置', async () => {
      const svc = new AIService({
        access: {
          mode: 'whitelist',
          users: ['vip'],
        },
      });
      expect(svc.getAccessConfig()).toEqual({
        mode: 'whitelist',
        users: ['vip'],
      });
      await svc.dispose();
    });
  });

  describe('工具管理', () => {
    it('standalone agents do not receive implicit tools', () => {
      expect(aiService.listRegisteredTools()).toEqual([]);
    });

    it('应该注册自定义工具', () => {
      const customTool: AgentTool = {
        name: 'custom_tool',
        description: '自定义工具',
        parameters: { type: 'object', properties: {} },
        execute: async () => 'result',
      };

      const dispose = aiService.registerTool(customTool);
      
      const tools = aiService.listRegisteredTools();
      expect(tools.some(t => t.name === 'custom_tool')).toBe(true);
      expect(Object.isFrozen(tools)).toBe(true);
      
      dispose();
      const toolsAfter = aiService.listRegisteredTools();
      expect(toolsAfter.some(t => t.name === 'custom_tool')).toBe(false);
    });

    it('rejects ambiguous duplicate registrations', async () => {
      const tool: AgentTool = {
        name: 'duplicate',
        description: 'first',
        parameters: { type: 'object', properties: {} },
        execute: async () => 'result',
      };
      aiService.registerTool(tool);

      expect(() => aiService.registerTool({ ...tool, description: 'second' }))
        .toThrow('already registered');
      expect(() => aiService.registerTool({ ...tool, name: ' duplicate ' }))
        .toThrow('canonical name');
      const models = await executionScope({ chat: executionBundle({ model: { id: 'fixture', api: 'fixture', provider: 'fixture', input: ['text'], contextWindow: 8192, maxTokens: 100 }, completion: { complete: async () => assistantTextReply('done') } }) });
      expect(() => aiService.createAgent({ models, tools: [tool], includeRegisteredTools: true }))
        .toThrow('Duplicate standalone Agent Tool');
      // Registered tools are opt-in: by default a standalone Agent starts with none.
      expect(() => aiService.createAgent({ models, tools: [tool] })).not.toThrow();
      await models.release();
    });
  });

  describe('dispose', () => {
    it('应该正确清理资源', async () => {
      await aiService.dispose();
      await expect(aiService.prepareModelRuntime({} as never)).rejects.toThrow('disposed');
    });
  });
});

// ============================================================================
// AI Trigger 工具函数测试
// ============================================================================

describe('AI Trigger 工具函数测试', () => {
  function createMockMessage(options: {
    content: string | any[];
    endpoint?: string;
    channelType?: 'private' | 'group' | 'channel';
    senderId?: string;
    senderPermissions?: string[];
  }) {
    const segments = typeof options.content === 'string'
      ? [{ type: 'text', data: { text: options.content } }]
      : options.content;
    const endpointId = options.endpoint || 'bot123';
    return {
      content: segments.filter((item: any) => item.type === 'text').map((item: any) => item.data.text).join(''),
      segments,
      endpointId,
      clientAdapter: 'test',
      conversation: { endpoint: { adapter: 'test', id: endpointId }, kind: options.channelType || 'private', id: 'channel1' },
      sender: { id: options.senderId || 'user1', roles: options.senderPermissions || [] },
      metadata: {},
    };
  }

  describe('shouldTriggerAI', () => {
    it('应该检测前缀触发', () => {
      const message = createMockMessage({ content: '# 你好' });
      const result = shouldTriggerAI(message as any, { prefixes: ['#'], respondToPrivate: false });
      
      expect(result.triggered).toBe(true);
      expect(result.content).toBe('你好');
    });

    it('没有匹配前缀时不应触发', () => {
      const message = createMockMessage({ content: '普通消息' });
      const result = shouldTriggerAI(message as any, { prefixes: ['#'], respondToPrivate: false });
      
      expect(result.triggered).toBe(false);
    });

    it('私聊应该直接触发', () => {
      const message = createMockMessage({ content: '你好', channelType: 'private' });
      const result = shouldTriggerAI(message as any, { respondToPrivate: true });
      
      expect(result.triggered).toBe(true);
      expect(result.content).toBe('你好');
    });

    it('禁用时不应触发', () => {
      const message = createMockMessage({ content: '# 你好' });
      const result = shouldTriggerAI(message as any, { enabled: false, prefixes: ['#'] });
      
      expect(result.triggered).toBe(false);
    });
  });

  describe('resolveSenderRoles', () => {
    it('应该正确解析 master 角色', () => {
      const message = createMockMessage({ content: 'test', senderId: 'owner1' });
      const result = resolveSenderRoles(message as any, { masters: ['owner1'] });
      expect(result.roles).toContain('master');
    });

    it('默认应该是 user 角色', () => {
      const message = createMockMessage({ content: 'test' });
      const result = resolveSenderRoles(message as any, {});
      expect(result.roles).toEqual(['user']);
    });
  });
});
