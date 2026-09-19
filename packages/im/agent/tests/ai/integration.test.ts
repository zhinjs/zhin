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
import { createSdkProviderAdapter } from '@zhin.js/ai';
import { shouldTriggerAI, resolveSenderRoles, type AgentTool } from '@zhin.js/core';

// ============================================================================
// AI Service 测试
// ============================================================================

describe('AI Service 集成测试', () => {
  let aiService: AIService;

  beforeEach(() => {
    vi.clearAllMocks();
    aiService = new AIService({
      providers: { mock: { sdk: 'openai', apiKey: 'sk-test' } },
      agents: { zhin: { provider: 'mock', model: 'gpt-4o-mini' } },
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

    it('配置了 provider 与 agents.zhin 时 isReady 为 true', () => {
      expect(aiService.isReady()).toBe(true);
    });

    it('应该返回已注册的 provider 别名', () => {
      expect(aiService.listProviders()).toEqual(['mock']);
    });

    it('获取不存在的提供商应抛出错误', () => {
      expect(() => aiService.getProvider('nonexistent')).toThrow();
    });

    it('应该根据配置初始化所有 Provider', async () => {
      const fullService = new AIService({
        providers: {
          openai: { sdk: 'openai', apiKey: 'sk-test' },
          anthropic: { sdk: 'anthropic', apiKey: 'sk-ant-test' },
          deepseek: { sdk: 'deepseek', apiKey: 'sk-deepseek' },
          moonshot: { sdk: 'openai-compatible', apiKey: 'sk-moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
          zhipu: { sdk: 'openai-compatible', apiKey: 'sk-zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
          ollama: { sdk: 'ollama', host: 'http://localhost:11434' },
        },
        agents: {
          zhin: { provider: 'openai', model: 'gpt-4o-mini' },
        },
      });

      const providers = fullService.listProviders();
      expect(providers).toContain('openai');
      expect(providers).toContain('anthropic');
      expect(providers).toContain('deepseek');
      expect(providers).toContain('moonshot');
      expect(providers).toContain('zhipu');
      expect(providers).toContain('ollama');
      expect(providers).toHaveLength(6);

      await fullService.dispose();
    });

    it('动态 Provider 加入既有 service-owned runtime', async () => {
      const runtime = aiService.getLlmRuntime();
      const provider = createSdkProviderAdapter('secondary', {
        sdk: 'openai',
        apiKey: 'sk-secondary',
        models: ['gpt-secondary'],
      });
      expect(provider).not.toBeNull();

      await aiService.registerProvider(provider!);

      expect(aiService.getLlmRuntime()).toBe(runtime);
      expect(runtime.model('secondary', 'gpt-secondary')).toMatchObject({
        provider: 'secondary',
        id: 'gpt-secondary',
      });
    });

    it('应该只初始化有 apiKey 的 Provider', async () => {
      const partialService = new AIService({
        providers: {
          openai: { sdk: 'openai', apiKey: 'sk-test' },
          deepseek: { sdk: 'deepseek' },
          moonshot: { sdk: 'openai-compatible', apiKey: 'sk-moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
        },
        agents: {
          zhin: { provider: 'openai', model: 'gpt-4o-mini' },
        },
      });

      const providers = partialService.listProviders();
      expect(providers).toContain('openai');
      expect(providers).toContain('moonshot');
      expect(providers).not.toContain('deepseek');
      expect(providers).toHaveLength(2);

      await partialService.dispose();
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
        providers: { mock: { sdk: 'openai', apiKey: 'sk-test' } },
        agents: { zhin: { provider: 'mock', model: 'gpt-4o-mini' } },
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

    it('rejects ambiguous duplicate registrations', () => {
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
      expect(() => aiService.createAgent({ tools: [tool] }))
        .toThrow('Duplicate standalone Agent Tool');
      expect(() => aiService.createAgent({
        tools: [tool],
        includeRegisteredTools: false,
      })).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('应该正确清理资源', async () => {
      await aiService.dispose();
      expect(aiService.listProviders()).toEqual([]);
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
    const content = typeof options.content === 'string' 
      ? [{ type: 'text', data: { text: options.content } }]
      : options.content;
    
    return {
      $content: content,
      $endpoint: options.endpoint || 'bot123',
      $channel: options.channelType ? { type: options.channelType, id: 'channel1' } : null,
      $sender: { 
        id: options.senderId || 'user1', 
        permissions: options.senderPermissions || [],
      },
      $adapter: 'test',
    };
  }

  describe('shouldTriggerAI', () => {
    it('应该检测前缀触发', () => {
      const message = createMockMessage({ content: '# 你好' });
      const result = shouldTriggerAI(message as any, { prefixes: ['#'] });
      
      expect(result.triggered).toBe(true);
      expect(result.content).toBe('你好');
    });

    it('没有匹配前缀时不应触发', () => {
      const message = createMockMessage({ content: '普通消息' });
      const result = shouldTriggerAI(message as any, { prefixes: ['#'] });
      
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
