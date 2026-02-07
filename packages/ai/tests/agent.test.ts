/**
 * Agent 集成测试
 * 
 * 测试 AI Agent 的完整流程，包括：
 * - 工具调用流程
 * - 对话历史管理
 * - 错误处理
 * - 重复调用检测
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockTool } from './setup.js';

// Mock Logger
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
  };
});

import { createAgent, Agent } from '../src/agent.js';

// 创建完整的 mock provider
const createMockProvider = () => ({
  name: 'mock',
  models: ['mock-model'],
  chat: vi.fn(),
  healthCheck: vi.fn().mockResolvedValue(true),
});

// 创建标准 chat 响应
const createChatResponse = (content: string, toolCalls?: any[]) => ({
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

describe('Agent 完整流程测试', () => {
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = createMockProvider();
  });

  describe('基本对话', () => {
    it('应该处理简单的文本响应', async () => {
      mockProvider.chat.mockResolvedValue(createChatResponse('你好！'));

      const agent = createAgent(mockProvider as any, {
        systemPrompt: '你是一个助手',
        tools: [],
      });

      const result = await agent.run('你好');

      expect(result.content).toBe('你好！');
      expect(result.iterations).toBe(1);
    });

    it('应该正确统计 token 用量', async () => {
      mockProvider.chat.mockResolvedValue(createChatResponse('回复'));

      const agent = createAgent(mockProvider as any, {
        tools: [],
      });

      const result = await agent.run('测试');

      expect(result.usage.total_tokens).toBe(20);
    });
  });

  describe('工具调用', () => {
    it('应该正确执行单个工具调用', async () => {
      const calculatorTool = createMockTool({
        name: 'calculator',
        description: '计算器',
        parameters: {
          expression: { type: 'string', description: '表达式' },
        },
        required: ['expression'],
        executeResult: JSON.stringify({ result: 42 }),
      });

      // 第一次调用返回工具调用
      mockProvider.chat
        .mockResolvedValueOnce(createChatResponse('', [{
          id: 'call-1',
          type: 'function',
          function: {
            name: 'calculator',
            arguments: JSON.stringify({ expression: '6 * 7' }),
          },
        }]))
        .mockResolvedValueOnce(createChatResponse('计算结果是 42'));

      const agent = createAgent(mockProvider as any, {
        tools: [calculatorTool],
      });

      const result = await agent.run('计算 6 * 7');
      
      // 工具应该被调用
      expect(calculatorTool.execute).toHaveBeenCalledWith(
        { expression: '6 * 7' }
      );
      
      // 应该返回最终结果
      expect(result.content).toBe('计算结果是 42');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe('calculator');
    });

    it('应该处理多个工具调用', async () => {
      const tool1 = createMockTool({
        name: 'tool1',
        executeResult: 'result1',
      });
      
      const tool2 = createMockTool({
        name: 'tool2',
        executeResult: 'result2',
      });

      mockProvider.chat
        .mockResolvedValueOnce(createChatResponse('', [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'tool1', arguments: '{}' },
          },
          {
            id: 'call-2',
            type: 'function',
            function: { name: 'tool2', arguments: '{}' },
          },
        ]))
        .mockResolvedValueOnce(createChatResponse('完成'));

      const agent = createAgent(mockProvider as any, {
        tools: [tool1, tool2],
      });

      const result = await agent.run('执行两个工具');
      
      expect(tool1.execute).toHaveBeenCalled();
      expect(tool2.execute).toHaveBeenCalled();
      expect(result.toolCalls).toHaveLength(2);
    });

    it('应该检测并阻止重复工具调用', async () => {
      const tool = createMockTool({
        name: 'repeatable',
        parameters: { query: { type: 'string' } },
        executeResult: 'result',
      });

      // 模拟重复调用同一工具
      mockProvider.chat
        .mockResolvedValueOnce(createChatResponse('', [{
          id: 'call-1',
          type: 'function',
          function: { name: 'repeatable', arguments: JSON.stringify({ query: 'same' }) },
        }]))
        .mockResolvedValueOnce(createChatResponse('', [{
          id: 'call-2',
          type: 'function',
          function: { name: 'repeatable', arguments: JSON.stringify({ query: 'same' }) },
        }]))
        .mockResolvedValueOnce(createChatResponse('完成'));

      const agent = createAgent(mockProvider as any, {
        tools: [tool],
      });

      const result = await agent.run('测试重复');
      
      // 工具应该只被实际执行一次（第一次）
      expect(tool.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('工具执行错误处理', () => {
    it('应该处理工具执行错误', async () => {
      const errorTool = createMockTool({
        name: 'error_tool',
        executeError: new Error('工具执行失败'),
      });

      mockProvider.chat
        .mockResolvedValueOnce(createChatResponse('', [{
          id: 'call-1',
          type: 'function',
          function: { name: 'error_tool', arguments: '{}' },
        }]))
        .mockResolvedValueOnce(createChatResponse('工具出错了'));

      const agent = createAgent(mockProvider as any, {
        tools: [errorTool],
      });

      const result = await agent.run('执行会出错的工具');
      
      // 应该继续执行，不会崩溃
      expect(result.content).toBeDefined();
    });

    it('应该处理不存在的工具调用', async () => {
      mockProvider.chat
        .mockResolvedValueOnce(createChatResponse('', [{
          id: 'call-1',
          type: 'function',
          function: { name: 'nonexistent', arguments: '{}' },
        }]))
        .mockResolvedValueOnce(createChatResponse('工具不存在'));

      const agent = createAgent(mockProvider as any, {
        tools: [],
      });

      const result = await agent.run('调用不存在的工具');
      
      // 应该继续执行，包含错误信息
      expect(result).toBeDefined();
    });
  });

  describe('事件监听', () => {
    it('应该触发 tool_call 事件', async () => {
      const tool = createMockTool({
        name: 'event_tool',
        executeResult: 'done',
      });

      mockProvider.chat
        .mockResolvedValueOnce(createChatResponse('', [{
          id: 'call-1',
          type: 'function',
          function: { name: 'event_tool', arguments: JSON.stringify({ test: true }) },
        }]))
        .mockResolvedValueOnce(createChatResponse('完成'));

      const agent = createAgent(mockProvider as any, {
        tools: [tool],
      });

      const toolCallHandler = vi.fn();
      agent.on('tool_call', toolCallHandler);

      await agent.run('测试事件');
      
      expect(toolCallHandler).toHaveBeenCalledWith('event_tool', { test: true });
    });

    it('应该触发 tool_result 事件', async () => {
      const tool = createMockTool({
        name: 'result_tool',
        executeResult: JSON.stringify({ data: 'test' }),
      });

      mockProvider.chat
        .mockResolvedValueOnce(createChatResponse('', [{
          id: 'call-1',
          type: 'function',
          function: { name: 'result_tool', arguments: '{}' },
        }]))
        .mockResolvedValueOnce(createChatResponse('完成'));

      const agent = createAgent(mockProvider as any, {
        tools: [tool],
      });

      const toolResultHandler = vi.fn();
      agent.on('tool_result', toolResultHandler);

      await agent.run('测试结果事件');
      
      // Result is the raw string from tool execution
      expect(toolResultHandler).toHaveBeenCalledWith(
        'result_tool', 
        expect.stringContaining('data')
      );
    });

    it('应该触发 complete 事件', async () => {
      mockProvider.chat.mockResolvedValue(createChatResponse('完成'));

      const agent = createAgent(mockProvider as any, {
        tools: [],
      });

      const completeHandler = vi.fn();
      agent.on('complete', completeHandler);

      await agent.run('测试');
      
      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '完成',
        })
      );
    });

    it('应该返回取消订阅函数', async () => {
      mockProvider.chat.mockResolvedValue(createChatResponse('ok'));

      const agent = createAgent(mockProvider as any, {
        tools: [],
      });

      const handler = vi.fn();
      const unsubscribe = agent.on('complete', handler);
      
      // 取消订阅
      unsubscribe();

      await agent.run('测试');
      
      // handler 不应该被调用
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe('Agent 配置测试', () => {
  it('应该使用自定义系统提示', async () => {
    const mockProvider = createMockProvider();
    mockProvider.chat.mockResolvedValue(createChatResponse('ok'));

    const agent = createAgent(mockProvider as any, {
      systemPrompt: '你是一个代码助手',
      tools: [],
    });

    await agent.run('你好');

    // 检查传递给 provider 的消息包含系统提示
    expect(mockProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('代码助手'),
          }),
        ]),
      })
    );
  });

  it('应该传递工具定义给 provider', async () => {
    const mockProvider = createMockProvider();
    mockProvider.chat.mockResolvedValue(createChatResponse('ok'));

    const tool = createMockTool({
      name: 'test_tool',
      description: '测试工具',
    });

    const agent = createAgent(mockProvider as any, {
      tools: [tool],
    });

    await agent.run('测试');

    expect(mockProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({
            type: 'function',
            function: expect.objectContaining({
              name: 'test_tool',
            }),
          }),
        ]),
      })
    );
  });

  it('应该限制最大迭代次数', async () => {
    const mockProvider = createMockProvider();
    
    // 模拟一直返回工具调用
    mockProvider.chat.mockResolvedValue(createChatResponse('', [{
      id: 'call-1',
      type: 'function',
      function: { name: 'infinite', arguments: '{}' },
    }]));

    const tool = createMockTool({
      name: 'infinite',
      executeResult: 'loop',
    });

    const agent = createAgent(mockProvider as any, {
      tools: [tool],
      maxIterations: 3,
    });

    const result = await agent.run('无限循环');
    
    // 应该在达到最大迭代次数后停止
    expect(result.iterations).toBeLessThanOrEqual(3);
  });
});

describe('Agent.filterTools 程序化过滤', () => {
  it('应该通过 keywords 匹配工具', () => {
    const tools = [
      createMockTool({ name: 'weather', description: '查询天气', keywords: ['天气', 'weather'] }),
      createMockTool({ name: 'calculator', description: '计算器', keywords: ['计算', 'calc'] }),
      createMockTool({ name: 'news', description: '新闻', keywords: ['新闻', 'news'] }),
    ] as any[];

    const result = Agent.filterTools('今天天气怎么样', tools);
    
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('weather');
  });

  it('应该通过 tags 匹配工具', () => {
    const tools = [
      createMockTool({ name: 'ai.models', description: '列出模型', tags: ['ai', 'management'] }),
      createMockTool({ name: 'weather', description: '天气', tags: ['weather', 'utility'] }),
    ] as any[];

    const result = Agent.filterTools('ai 相关功能', tools);

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toBe('ai.models');
  });

  it('应该通过工具名 token 匹配', () => {
    const tools = [
      createMockTool({ name: 'gold_price', description: '查询金价' }),
      createMockTool({ name: 'fuel_price', description: '查询油价' }),
    ] as any[];

    const result = Agent.filterTools('gold 价格', tools);

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toBe('gold_price');
  });

  it('应该按权限过滤工具', () => {
    const tools = [
      createMockTool({ name: 'public_tool', description: '公共工具' }),
      createMockTool({ name: 'admin_tool', description: '管理员工具' }),
    ] as any[];
    // 设置权限级别
    tools[0].permissionLevel = 0;
    tools[1].permissionLevel = 3;

    const result = Agent.filterTools('管理', tools, { callerPermissionLevel: 1 });

    // admin_tool 需要 3，用户只有 1，应该被过滤掉
    const names = result.map((t: any) => t.name);
    expect(names).not.toContain('admin_tool');
  });

  it('应该按分数排序并限制数量', () => {
    const tools = [
      createMockTool({ name: 'tool1', description: '天气查询', keywords: ['天气'] }),
      createMockTool({ name: 'tool2', description: '天气预报', keywords: ['天气', '预报'] }),
      createMockTool({ name: 'tool3', description: '无关工具' }),
    ] as any[];

    const result = Agent.filterTools('天气预报', tools, { maxTools: 2 });

    expect(result.length).toBeLessThanOrEqual(2);
    // tool2 应该排更前面（匹配了两个 keywords）
    if (result.length >= 2) {
      expect(result[0].name).toBe('tool2');
    }
  });

  it('空消息应该返回空结果', () => {
    const tools = [
      createMockTool({ name: 'tool1', description: '工具', keywords: ['关键词'] }),
    ] as any[];

    const result = Agent.filterTools('', tools);

    expect(result).toHaveLength(0);
  });

  it('无工具时应该返回空结果', () => {
    const result = Agent.filterTools('测试消息', []);

    expect(result).toHaveLength(0);
  });

  it('应该支持中文描述双向匹配', () => {
    const tools = [
      createMockTool({ name: 'get_time', description: '获取当前时间和日期信息' }),
      createMockTool({ name: 'weather', description: '查询天气信息' }),
    ] as any[];

    // "时间" 出现在 get_time 的描述中（双向匹配）
    const result = Agent.filterTools('时间', tools);

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toBe('get_time');
  });
});

describe('Agent run 带过滤选项', () => {
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = createMockProvider();
  });

  it('应该用过滤后的工具调用 AI', async () => {
    mockProvider.chat.mockResolvedValue(createChatResponse('ok'));

    const relevantTool = createMockTool({ name: 'weather', description: '天气', keywords: ['天气'] });
    const irrelevantTool = createMockTool({ name: 'calculator', description: '计算', keywords: ['计算'] });

    const agent = createAgent(mockProvider as any, {
      tools: [relevantTool, irrelevantTool] as any[],
    });

    await agent.run('天气怎么样', undefined, { maxTools: 5, minScore: 0.1 });

    // 应该只传递匹配的工具给 AI
    const chatCall = mockProvider.chat.mock.calls[0][0];
    if (chatCall.tools) {
      const toolNames = chatCall.tools.map((t: any) => t.function.name);
      expect(toolNames).toContain('weather');
      expect(toolNames).not.toContain('calculator');
    }
  });
});

describe('Agent 类', () => {
  it('应该正确创建实例', () => {
    const mockProvider = createMockProvider();
    const agent = new Agent(mockProvider as any, {
      tools: [],
    });

    expect(agent).toBeInstanceOf(Agent);
  });

  it('应该支持动态添加工具', async () => {
    const mockProvider = createMockProvider();
    mockProvider.chat.mockResolvedValue(createChatResponse('ok'));

    const agent = new Agent(mockProvider as any, {
      tools: [],
    });

    const tool = createMockTool({ name: 'dynamic_tool' });
    agent.addTool(tool);

    await agent.run('测试');

    expect(mockProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({
            function: expect.objectContaining({
              name: 'dynamic_tool',
            }),
          }),
        ]),
      })
    );
  });

  it('应该支持动态移除工具', async () => {
    const mockProvider = createMockProvider();
    mockProvider.chat.mockResolvedValue(createChatResponse('ok'));

    const tool = createMockTool({ name: 'removable' });
    const agent = new Agent(mockProvider as any, {
      tools: [tool],
    });

    agent.removeTool('removable');

    await agent.run('测试');

    // 应该没有工具
    expect(mockProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: undefined,
      })
    );
  });
});
