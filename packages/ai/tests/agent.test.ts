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
import { createMockTool, createMockProvider, createChatResponse } from './setup.js';

vi.mock('@zhin.js/logger', async (importOriginal) => {
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

import { createAgent, Agent } from '@zhin.js/ai';

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

      expect(calculatorTool.execute).toHaveBeenCalledWith(
        { expression: '6 * 7' }
      );
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

      await agent.run('测试重复');
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
      unsubscribe();

      await agent.run('测试');
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
      createMockTool({ name: 'ai_models', description: '列出模型', tags: ['ai', 'management'] }),
      createMockTool({ name: 'weather', description: '天气', tags: ['weather', 'utility'] }),
    ] as any[];

    const result = Agent.filterTools('ai 相关功能', tools);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toBe('ai_models');
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
    tools[0].permissionLevel = 0;
    tools[1].permissionLevel = 3;

    const result = Agent.filterTools('管理', tools, { callerPermissionLevel: 1 });
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
    expect(mockProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: undefined,
      })
    );
  });
});

describe('模型自动降级', () => {
  it('主模型失败时自动降级到 fallback 模型', async () => {
    const mockProvider = createMockProvider();
    let callCount = 0;
    mockProvider.chat.mockImplementation(async (req: any) => {
      callCount++;
      if (req.model === 'primary-model') {
        throw new Error('rate limit exceeded');
      }
      return createChatResponse('来自降级模型的回复');
    });

    const agent = createAgent(mockProvider as any, {
      model: 'primary-model',
      modelFallbacks: ['fallback-model-a', 'fallback-model-b'],
    });

    const result = await agent.run('你好');
    expect(result.content).toBe('来自降级模型的回复');
    // Should have called primary first, then fallback-a
    expect(callCount).toBe(2);
    expect(mockProvider.chat).toHaveBeenCalledWith(expect.objectContaining({ model: 'primary-model' }));
    expect(mockProvider.chat).toHaveBeenCalledWith(expect.objectContaining({ model: 'fallback-model-a' }));
  });

  it('所有模型失败时返回错误信息', async () => {
    const mockProvider = createMockProvider();
    mockProvider.chat.mockRejectedValue(new Error('all models down'));

    const agent = createAgent(mockProvider as any, {
      model: 'model-a',
      modelFallbacks: ['model-b'],
    });

    const result = await agent.run('你好');
    expect(result.content).toContain('all models down');
  });

  it('降级成功后后续轮次使用降级模型', async () => {
    const mockProvider = createMockProvider();
    const modelsUsed: string[] = [];
    mockProvider.chat.mockImplementation(async (req: any) => {
      modelsUsed.push(req.model);
      if (req.model === 'broken-model' && modelsUsed.length === 1) {
        throw new Error('first call fails');
      }
      return createChatResponse('回复');
    });

    const agent = createAgent(mockProvider as any, {
      model: 'broken-model',
      modelFallbacks: ['working-model'],
    });

    const result = await agent.run('你好');
    expect(result.content).toBe('回复');
    // First call to broken-model fails, second to working-model succeeds
    expect(modelsUsed[0]).toBe('broken-model');
    expect(modelsUsed[1]).toBe('working-model');
  });

  it('无 fallback 时返回错误信息', async () => {
    const mockProvider = createMockProvider();
    mockProvider.chat.mockRejectedValue(new Error('model error'));

    const agent = createAgent(mockProvider as any, {
      model: 'only-model',
    });

    const result = await agent.run('你好');
    expect(result.content).toContain('model error');
  });
});
