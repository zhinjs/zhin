/**
 * AI 模块集成测试
 * 
 * 完整测试环境，包括：
 * 1. AI 服务初始化
 * 2. 工具服务功能
 * 3. AI 触发中间件
 * 4. 内置工具
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Logger first
vi.mock('@zhin.js/core', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    defineModel: vi.fn(), // Mock defineModel
    // 保留原始 getPlugin（依赖 AsyncLocalStorage）；勿全局 stub，否则 hook-registry / write-file 等单测失效
    usePlugin: vi.fn(() => ({
      name: 'test-plugin',
      root: { 
        inject: vi.fn(),
        dispatch: vi.fn().mockResolvedValue(undefined),
        addMiddleware: vi.fn(),
      },
      provide: vi.fn(),
      useContext: vi.fn(),
      addMiddleware: vi.fn(),
      defineModel: vi.fn(),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })),
    Logger: class {
      debug = vi.fn();
      info = vi.fn();
      warn = vi.fn();
      error = vi.fn();
    },
    getPlugin: vi.fn(() => ({ root: {} })),
    resolveSubjectRoles: vi.fn((_plugin: unknown, message: { _roles?: string[] }) => ({
      scope: 'private',
      roles: message?._roles ?? ['user'],
    })),
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

// Import after mocking — AIService + builtin tools from agent; Tool/trigger from core
import { AIService } from '@zhin.js/agent';
import * as core from '@zhin.js/core';
import { ToolFeature, ZhinTool, shouldTriggerAI, resolveSenderRoles } from '@zhin.js/core';
import type { Tool, Message, AgentTool } from '@zhin.js/core';

// ============================================================================
// AI Service 测试
// ============================================================================

describe('AI Service 集成测试', () => {
  let aiService: AIService;

  beforeEach(() => {
    vi.clearAllMocks();
    aiService = new AIService({
      providers: { mock: { driver: 'openai', apiKey: 'sk-test' } },
      agents: { zhin: { provider: 'mock', model: 'gpt-4o-mini' } },
      sessions: { maxHistory: 10 },
    });
  });

  afterEach(() => {
    aiService?.dispose();
  });

  describe('服务初始化', () => {
    it('应该创建 AI 服务实例', () => {
      expect(aiService).toBeDefined();
      expect(aiService.sessions).toBeDefined();
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

    it('应该根据配置初始化所有 Provider', () => {
      const fullService = new AIService({
        providers: {
          openai: { driver: 'openai', apiKey: 'sk-test' },
          anthropic: { driver: 'anthropic', apiKey: 'sk-ant-test' },
          deepseek: { driver: 'deepseek', apiKey: 'sk-deepseek' },
          moonshot: { driver: 'moonshot', apiKey: 'sk-moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
          zhipu: { driver: 'zhipu', apiKey: 'sk-zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
          ollama: { driver: 'ollama', host: 'http://localhost:11434' },
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

      fullService.dispose();
    });

    it('应该只初始化有 apiKey 的 Provider', () => {
      const partialService = new AIService({
        providers: {
          openai: { driver: 'openai', apiKey: 'sk-test' },
          deepseek: { driver: 'deepseek' },
          moonshot: { driver: 'moonshot', apiKey: 'sk-moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
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

      partialService.dispose();
    });
  });

  describe('配置管理', () => {
    it('应该返回会话配置', () => {
      const config = aiService.getSessionConfig();
      expect(config.maxHistory).toBe(10);
    });

    it('应该返回上下文配置', () => {
      const config = aiService.getContextConfig();
      expect(config).toBeDefined();
    });

    it('应该返回触发器配置', () => {
      const config = aiService.getTriggerConfig();
      expect(config).toBeDefined();
    });
  });

  describe('工具管理', () => {
    it('应该收集内置工具', () => {
      const tools = aiService.collectAllTools();
      expect(Array.isArray(tools)).toBe(true);
      const names = tools.map(t => t.name);
      expect(names).toEqual(['web_search']);
    });

    it('getResidentToolsAsTools 应包含 web_search', () => {
      const resident = aiService.getResidentToolsAsTools();
      expect(resident.map(t => t.name)).toEqual(['web_search']);
    });

    it('setPlugin 后常驻工具含 ask_user', () => {
      const plugin = { addMiddleware: vi.fn(), inject: vi.fn() } as unknown as import('@zhin.js/core').Plugin;
      aiService.setPlugin(plugin);
      expect(aiService.getResidentToolsAsTools().map(t => t.name)).toEqual(['web_search', 'ask_user']);
      expect(aiService.collectAllTools().map(t => t.name)).toEqual(['web_search', 'ask_user']);
    });

    it('应该注册自定义工具', () => {
      const customTool: AgentTool = {
        name: 'custom_tool',
        description: '自定义工具',
        parameters: { type: 'object', properties: {} },
        execute: async () => 'result',
      };

      const dispose = aiService.registerTool(customTool);
      
      const tools = aiService.collectAllTools();
      expect(tools.some(t => t.name === 'custom_tool')).toBe(true);
      
      dispose();
      const toolsAfter = aiService.collectAllTools();
      expect(toolsAfter.some(t => t.name === 'custom_tool')).toBe(false);
    });
  });

  describe('dispose', () => {
    it('应该正确清理资源', () => {
      aiService.dispose();
      expect(aiService.listProviders()).toEqual([]);
    });
  });
});

// ============================================================================
// Tool Service 测试
// ============================================================================

describe('Tool Service 集成测试', () => {
  let service: ToolFeature;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ToolFeature();
  });

  describe('Context 创建', () => {
    it('应该创建正确的 Context', () => {
      expect(service.name).toBe('tool');
      expect(service.desc).toBeDefined();
      expect(service.icon).toBe('Wrench');
    });
  });

  describe('工具注册', () => {
    it('应该注册 Tool 对象', () => {
      const tool: Tool = {
        name: 'test_tool',
        description: '测试工具',
        parameters: { type: 'object', properties: {} },
        execute: async () => 'result',
      };

      const dispose = service.addTool(tool, 'test-plugin', false);
      
      expect(service.get('test_tool')).toBeDefined();
      expect(service.getAll()).toHaveLength(1);
      
      dispose();
      expect(service.get('test_tool')).toBeUndefined();
    });

    it('应该注册 ZhinTool 实例', () => {
      const zhinTool = new ZhinTool('zhin_tool')
        .desc('ZhinTool 测试')
        .execute(async () => 'result');

      service.addTool(zhinTool, 'test-plugin', false);
      
      const registered = service.get('zhin_tool');
      expect(registered).toBeDefined();
      expect(registered?.description).toBe('ZhinTool 测试');
    });

    it('应该正确移除工具', () => {
      const tool: Tool = {
        name: 'removable',
        description: '',
        parameters: { type: 'object', properties: {} },
        execute: async () => '',
      };

      service.addTool(tool, 'test', false);
      expect(service.removeTool('removable')).toBe(true);
      expect(service.removeTool('removable')).toBe(false);
    });

    it('应该自动添加来源标识', () => {
      const tool: Tool = {
        name: 'sourced_tool',
        description: '',
        parameters: { type: 'object', properties: {} },
        execute: async () => '',
      };

      service.addTool(tool, 'my-plugin', false);
      
      const registered = service.get('sourced_tool');
      expect(registered?.source).toContain('my-plugin');
      expect(registered?.tags).toContain('my-plugin');
    });
  });

  describe('工具执行', () => {
    it('应该执行已注册的工具', async () => {
      const tool: Tool = {
        name: 'executable',
        description: '',
        parameters: { type: 'object', properties: {} },
        execute: async (args) => `received: ${JSON.stringify(args)}`,
      };

      service.addTool(tool, 'test', false);
      
      const result = await service.execute('executable', { key: 'value' });
      expect(result).toBe('received: {"key":"value"}');
    });

    it('执行不存在的工具应抛出错误', async () => {
      await expect(service.execute('nonexistent', {})).rejects.toThrow('not found');
    });
  });

  describe('标签过滤', () => {
    it('应该按标签过滤工具', () => {
      service.addTool({
        name: 'tagged1',
        description: '',
        parameters: { type: 'object', properties: {} },
        tags: ['utility'],
        execute: async () => '',
      }, 'test', false);
      
      service.addTool({
        name: 'tagged2',
        description: '',
        parameters: { type: 'object', properties: {} },
        tags: ['helper'],
        execute: async () => '',
      }, 'test', false);

      const utilityTools = service.getByTags(['utility']);
      expect(utilityTools).toHaveLength(1);
      expect(utilityTools[0].name).toBe('tagged1');
    });
  });

  describe('上下文过滤', () => {
    it('应该按平台过滤工具', () => {
      service.addTool({
        name: 'qq_only',
        description: '',
        parameters: { type: 'object', properties: {} },
        platforms: ['qq'],
        execute: async () => '',
      }, 'test', false);
      
      service.addTool({
        name: 'all_platforms',
        description: '',
        parameters: { type: 'object', properties: {} },
        execute: async () => '',
      }, 'test', false);

      const qqContext = { $adapter: 'qq', $endpoint: 'b1', $sender: { id: 'u1' }, $channel: { type: 'group', id: 'g1' } } as import('@zhin.js/core').Message<any>;
      const telegramContext = { $adapter: 'telegram', $endpoint: 'b1', $sender: { id: 'u1' }, $channel: { type: 'group', id: 'g1' } } as import('@zhin.js/core').Message<any>;
      
      const allTools = service.getAll();
      
      const qqFiltered = service.filterByContext(allTools, qqContext);
      expect(qqFiltered.some(t => t.name === 'qq_only')).toBe(true);
      expect(qqFiltered.some(t => t.name === 'all_platforms')).toBe(true);
      
      const telegramFiltered = service.filterByContext(allTools, telegramContext);
      expect(telegramFiltered.some(t => t.name === 'qq_only')).toBe(false);
      expect(telegramFiltered.some(t => t.name === 'all_platforms')).toBe(true);
    });

    it('应该按权限过滤工具', () => {
      service.addTool({
        name: 'admin_tool',
        description: '',
        parameters: { type: 'object', properties: {} },
        permissions: ['role(master)'],
        execute: async () => '',
      }, 'test', false);

      const allTools = service.getAll();
      
      const userContext = {
        $adapter: 'qq',
        $endpoint: 'b1',
        $sender: { id: 'user1', isMaster: false, isTrusted: false },
        $channel: { type: 'private', id: 'user1' },
      } as import('@zhin.js/core').Message<any>;
      const adminContext = {
        $adapter: 'process',
        $endpoint: 'b1',
        $sender: { id: 'admin1', isMaster: true },
        $channel: { type: 'private', id: 'admin1' },
      } as import('@zhin.js/core').Message<any>;
      
      const userFiltered = service.filterByContext(allTools, userContext);
      expect(userFiltered.some(t => t.name === 'admin_tool')).toBe(false);
      
      const adminFiltered = service.filterByContext(allTools, adminContext);
      expect(adminFiltered.some(t => t.name === 'admin_tool')).toBe(true);
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

// ============================================================================
// ZhinTool 完整流程测试
// ============================================================================

describe('ZhinTool 完整流程', () => {
  it('应该支持完整的工具定义流程', async () => {
    const tool = new ZhinTool('complete_tool')
      .desc('完整测试工具')
      .param('required_param', { type: 'string', description: '必填参数' }, true)
      .param('optional_param', { type: 'number', description: '可选参数' }, false)
      .platform('qq', 'telegram')
      .scope('group', 'private')
      .tag('test', 'example')
      .execute(async (args, message) => {
        return {
          received: args,
          platform: message?.$adapter,
        };
      });

    // 转换为 Tool
    const toolObj = tool.toTool();
    
    // 验证基本属性
    expect(toolObj.name).toBe('complete_tool');
    expect(toolObj.description).toBe('完整测试工具');
    expect(toolObj.platforms).toEqual(['qq', 'telegram']);
    expect(toolObj.scopes).toEqual(['group', 'private']);
    expect(toolObj.tags).toContain('test');
    expect(toolObj.tags).toContain('example');
    
    // 验证参数
    expect(toolObj.parameters.properties).toHaveProperty('required_param');
    expect(toolObj.parameters.properties).toHaveProperty('optional_param');
    expect(toolObj.parameters.required).toContain('required_param');
    
    // 验证执行
    const commMessage = {
      $adapter: 'qq',
      $endpoint: 'bot1',
      $sender: { id: 'user1' },
      $channel: { type: 'group' as const, id: 'g1' },
    } as import('@zhin.js/core').Message<any>;
    const result = await toolObj.execute(
      { required_param: 'test', optional_param: 42 },
      commMessage,
    );
    
    expect(result.received.required_param).toBe('test');
    expect(result.received.optional_param).toBe(42);
    expect(result.platform).toBe('qq');
    
    // 验证 JSON 输出
    const json = tool.toJSON();
    expect(json.name).toBe('complete_tool');
    expect(json).not.toHaveProperty('execute');
    
    // 验证帮助信息
    const help = tool.help;
    expect(help).toContain('complete_tool');
    expect(help).toContain('必填参数');
    expect(help).toContain('可选参数');
  });
});
