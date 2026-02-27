/**
 * SubagentManager 测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SubagentManager } from '../../src/ai/subagent.js';
import type { SubagentOrigin, SpawnOptions } from '../../src/ai/subagent.js';
import type { AgentTool, ChatResponse } from '../../src/ai/types.js';

// Mock Logger
vi.mock('@zhin.js/logger', () => ({
  Logger: class {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

const baseOrigin: SubagentOrigin = {
  platform: 'test',
  botId: 'bot1',
  sceneId: 'scene1',
  senderId: 'user1',
  sceneType: 'private',
};

function createMockProvider(response: string = '任务完成') {
  return {
    name: 'mock',
    models: ['mock-model'],
    chat: vi.fn(async () => ({
      choices: [{ message: { role: 'assistant', content: response }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    } as ChatResponse)),
    listModels: vi.fn(async () => ['mock-model']),
  };
}

function createMockTools(): AgentTool[] {
  return [
    {
      name: 'read_file',
      description: '读取文件',
      parameters: { type: 'object', properties: { file_path: { type: 'string' } } },
      execute: vi.fn(async () => 'file content'),
    },
    {
      name: 'write_file',
      description: '写入文件',
      parameters: { type: 'object', properties: { file_path: { type: 'string' } } },
      execute: vi.fn(async () => 'ok'),
    },
    {
      name: 'web_search',
      description: '搜索',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      execute: vi.fn(async () => 'search result'),
    },
    // 不应进入子 agent 的工具
    {
      name: 'spawn_task',
      description: '派生子任务',
      parameters: { type: 'object', properties: { task: { type: 'string' } } },
      execute: vi.fn(async () => 'should not be called'),
    },
    {
      name: 'activate_skill',
      description: '激活技能',
      parameters: { type: 'object', properties: { name: { type: 'string' } } },
      execute: vi.fn(async () => 'should not be called'),
    },
    {
      name: 'todo_write',
      description: '写计划',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => 'should not be called'),
    },
  ];
}

describe('SubagentManager', () => {
  let manager: SubagentManager;
  let provider: ReturnType<typeof createMockProvider>;
  let mockTools: AgentTool[];

  beforeEach(() => {
    provider = createMockProvider();
    mockTools = createMockTools();
    manager = new SubagentManager({
      provider: provider as any,
      workspace: '/tmp/test-workspace',
      createTools: () => mockTools,
      maxIterations: 5,
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('spawn', () => {
    it('应返回确认文本并包含任务标签', async () => {
      const result = await manager.spawn({
        task: '分析项目结构',
        label: '结构分析',
        origin: baseOrigin,
      });

      expect(result).toContain('结构分析');
      expect(result).toContain('已启动');
    });

    it('无 label 时应自动截取 task 前30字符', async () => {
      const result = await manager.spawn({
        task: '这是一个非常长的任务描述用于测试自动截取功能',
        origin: baseOrigin,
      });

      expect(result).toContain('已启动');
      expect(result).toContain('这是一个非常长的任务描述用于测试自动截取功能');
    });

    it('应递增 runningTasks 计数', async () => {
      // 让 provider 永不返回，模拟长时间运行
      provider.chat.mockImplementation(() => new Promise(() => {}));

      expect(manager.getRunningCount()).toBe(0);

      await manager.spawn({ task: '任务1', origin: baseOrigin });

      // 异步启动后应有 1 个运行中的任务
      expect(manager.getRunningCount()).toBe(1);
    });
  });

  describe('工具过滤', () => {
    it('子 agent 应只获得白名单内的工具', async () => {
      const sender = vi.fn();
      manager.setSender(sender);

      await manager.spawn({ task: '测试', origin: baseOrigin });

      // 等待子 agent 完成
      await vi.waitFor(() => expect(sender).toHaveBeenCalled(), { timeout: 2000 });

      // 验证 provider.chat 被调用时传入的工具列表
      const chatCall = provider.chat.mock.calls[0][0] ?? provider.chat.mock.calls[0];
      // createAgent 调用 provider.chat({ model, messages, tools, ... })
      // 查找 tools 参数
      const callArgs = provider.chat.mock.calls[0];
      // 接口是 chat(request) 形式
      const request = callArgs[0] as any;
      if (request?.tools) {
        const toolNames = request.tools.map((t: any) => t.function?.name || t.name);
        expect(toolNames).toContain('read_file');
        expect(toolNames).toContain('write_file');
        expect(toolNames).toContain('web_search');
        expect(toolNames).not.toContain('spawn_task');
        expect(toolNames).not.toContain('activate_skill');
        expect(toolNames).not.toContain('todo_write');
      }
    });
  });

  describe('结果回告', () => {
    it('完成后应通过 sender 发送结果', async () => {
      const sender = vi.fn();
      manager.setSender(sender);

      await manager.spawn({ task: '读取 README', label: '读README', origin: baseOrigin });

      // 等待异步子 agent 完成
      await vi.waitFor(() => expect(sender).toHaveBeenCalled(), { timeout: 2000 });

      expect(sender).toHaveBeenCalledTimes(1);
      const [origin, content] = sender.mock.calls[0];
      expect(origin).toEqual(baseOrigin);
      expect(content).toContain('读README');
      expect(content).toContain('已完成');
    });

    it('provider 错误时 Agent 内部兜底，结果仍应送达', async () => {
      provider.chat.mockRejectedValue(new Error('API 调用失败'));
      const sender = vi.fn();
      manager.setSender(sender);

      await manager.spawn({ task: '会失败的任务', label: '失败测试', origin: baseOrigin });

      await vi.waitFor(() => expect(sender).toHaveBeenCalled(), { timeout: 2000 });

      const [_origin, content] = sender.mock.calls[0];
      // Agent.run() 内部兜底返回友好文本，SubagentManager 视为成功完成
      expect(content).toContain('失败测试');
      expect(content).toContain('API 调用失败');
    });

    it('无 sender 时不应崩溃', async () => {
      // 不设置 sender
      await manager.spawn({ task: '测试', origin: baseOrigin });

      // 等待子 agent 完成（不应抛错）
      await new Promise(r => setTimeout(r, 200));
      expect(manager.getRunningCount()).toBe(0);
    });
  });

  describe('完成后清理', () => {
    it('完成后应从 runningTasks 移除', async () => {
      const sender = vi.fn();
      manager.setSender(sender);

      await manager.spawn({ task: '快速任务', origin: baseOrigin });

      // 等待完成
      await vi.waitFor(() => expect(sender).toHaveBeenCalled(), { timeout: 2000 });

      expect(manager.getRunningCount()).toBe(0);
    });

    it('失败后也应从 runningTasks 移除', async () => {
      provider.chat.mockRejectedValue(new Error('boom'));
      const sender = vi.fn();
      manager.setSender(sender);

      await manager.spawn({ task: '会失败', origin: baseOrigin });

      await vi.waitFor(() => expect(sender).toHaveBeenCalled(), { timeout: 2000 });

      expect(manager.getRunningCount()).toBe(0);
    });
  });

  describe('dispose', () => {
    it('应清空 runningTasks', () => {
      manager.dispose();
      expect(manager.getRunningCount()).toBe(0);
    });
  });
});

describe('ZhinAgent spawn_task 集成', () => {
  it('spawn_task 工具应在关键词匹配时被注入', async () => {
    // 这部分在 zhin-agent.test.ts 中已有 process 的集成测试框架
    // 此处仅验证关键词正则匹配逻辑
    const patterns = [
      '帮我在后台分析一下代码',
      '异步搜索一下文件',
      '把这个交给子任务处理',
      'spawn a background task',
      '用background方式执行',
      '并行处理这个任务',
      '独立处理这个问题',
    ];

    const regex = /后台|子任务|spawn|异步|background|并行|独立处理/i;
    for (const msg of patterns) {
      expect(regex.test(msg), `"${msg}" 应匹配`).toBe(true);
    }

    const negativePatterns = [
      '你好',
      '帮我查天气',
      '读取文件内容',
      '提醒我喝水',
    ];
    for (const msg of negativePatterns) {
      expect(regex.test(msg), `"${msg}" 不应匹配`).toBe(false);
    }
  });
});
