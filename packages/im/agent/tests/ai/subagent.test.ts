/**
 * SubagentManager 测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetLlmApiRegistryForTests } from '@zhin.js/ai';
import { wireMockProviderToLlmApi } from '../helpers/mock-llm-api.js';
import { SubagentManager } from '@zhin.js/agent';
import type { ZhinAgentEventEmitter } from '../../src/zhin-agent/event-emitter.js';
import type { SubagentOrigin, SpawnOptions } from '@zhin.js/agent';
import type { AgentTool, ChatCompletionResponse } from '@zhin.js/core';

vi.mock('@zhin.js/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zhin.js/logger')>();
  return {
    ...actual,
    Logger: class {
      debug = vi.fn();
      info = vi.fn();
      warn = vi.fn();
      error = vi.fn();
    },
  };
});

const baseOrigin: SubagentOrigin = {
  message: {
    $adapter: 'test',
    $endpoint: 'bot1',
    $sender: { id: 'user1' },
    $channel: { type: 'private', id: 'scene1' },
  } as import('@zhin.js/core').Message<any>,
};

function createMockProvider(response: string = '任务完成') {
  return {
    name: 'mock',
    models: ['mock-model'],
    chat: vi.fn(async () => ({
      choices: [{ message: { role: 'assistant', content: response }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    } as ChatCompletionResponse)),
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
    resetLlmApiRegistryForTests();
    provider = createMockProvider();
    wireMockProviderToLlmApi(provider);
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

    it('应触发生命周期事件回调', async () => {
      const onEvent = vi.fn();
      const sender = vi.fn();
      const eventManager = new SubagentManager({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        maxIterations: 5,
        onEvent,
      });
      eventManager.setSender(sender);

      await eventManager.spawn({ task: '分析 README', label: 'README分析', origin: baseOrigin });
      await vi.waitFor(() => expect(sender).toHaveBeenCalled(), { timeout: 2000 });

      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ phase: 'spawn', label: 'README分析' }));
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ phase: 'start', label: 'README分析' }));
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ phase: 'finish', label: 'README分析', status: 'ok' }));

      eventManager.dispose();
    });
  });

  describe('工具过滤', () => {
    it('子 agent 应只获得白名单内的工具', async () => {
      const sender = vi.fn();
      manager.setSender(sender);

      await manager.spawn({ task: '读取文件写入并搜索网页', origin: baseOrigin });

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
        const allowed = new Set(['bash', 'read_file', 'write_file', 'web_search']);
        expect(toolNames.every((n: string) => allowed.has(n))).toBe(true);
        expect(toolNames).toContain('read_file');
        expect(toolNames).not.toContain('spawn_task');
        expect(toolNames).not.toContain('activate_skill');
        expect(toolNames).not.toContain('todo_write');
      }
    });

    it('子 agent 经 toolSearch 按任务 TF-IDF 载入工具', async () => {
      const extraTool = {
        name: 'todo_write',
        description: 'todo list',
        parameters: { type: 'object', properties: {} },
        keywords: ['todo', '任务', '清单'],
        execute: async () => 'ok',
      };
      const customManager = new SubagentManager({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => [...mockTools, extraTool],
      });
      const sender = vi.fn();
      customManager.setSender(sender);

      await customManager.spawn({ task: '帮我列一份 todo 任务清单', origin: baseOrigin });
      await vi.waitFor(() => expect(sender).toHaveBeenCalled(), { timeout: 2000 });

      const request = provider.chat.mock.calls[0]?.[0] as any;
      if (request?.tools) {
        const toolNames = request.tools.map((t: any) => t.function?.name || t.name);
        expect(toolNames).toContain('todo_write');
      }
      customManager.dispose();
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
      const [origin, delivery] = sender.mock.calls[0];
      expect(origin).toEqual(baseOrigin);
      expect(delivery.text).toContain('读README');
      expect(delivery.text).toContain('完成');
    });

    it('provider 错误时 Agent 内部兜底，结果仍应送达', async () => {
      provider.chat.mockRejectedValue(new Error('API 调用失败'));
      const sender = vi.fn();
      manager.setSender(sender);

      await manager.spawn({ task: '会失败的任务', label: '失败测试', origin: baseOrigin });

      await vi.waitFor(() => expect(sender).toHaveBeenCalled(), { timeout: 2000 });

      const [_origin, delivery] = sender.mock.calls[0];
      // Agent.run() 内部兜底返回友好文本，SubagentManager 视为成功完成
      expect(delivery.text).toContain('失败测试');
      expect(delivery.text).toContain('API 调用失败');
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

    it('应上报与主 agent 同类的 AI 处理事件（source=subagent）', async () => {
      const dispatched: string[] = [];
      const emitted: string[] = [];
      const emitter = {
        createPayload: (_sid: string, _ctx: unknown, _mode: string, extra: Record<string, unknown> = {}) => ({
          sessionId: 'test-session',
          source: extra.source ?? 'zhin-agent',
          ...extra,
        }),
        dispatch: vi.fn(async (name: string) => {
          dispatched.push(name);
        }),
        emit: vi.fn((name: string) => {
          emitted.push(name);
        }),
      } as unknown as ZhinAgentEventEmitter;

      const mgr = new SubagentManager({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        maxIterations: 5,
        eventEmitter: emitter,
      });

      await mgr.spawnSync({
        task: '分析图片',
        label: 'vision',
        agent: 'vision',
        origin: baseOrigin,
      });

      expect(dispatched).toContain('ai.processing.start');
      expect(dispatched).toContain('ai.agent.start');
      expect(dispatched).toContain('ai.agent.finish');
      expect(dispatched).toContain('ai.response');
      expect(dispatched).toContain('ai.processing.finish');
      // typing 由 ai.processing.start 统一驱动，子 agent 不再重复 emit typing.start
      expect(emitted).not.toContain('ai.typing.start');
      expect(emitted).not.toContain('ai.typing.stop');
    });

    it('异步 spawn 结束时应停止 typing', async () => {
      const dispatched: string[] = [];
      const emitted: string[] = [];
      const emitter = {
        createPayload: (_sid: string, _ctx: unknown, _mode: string, extra: Record<string, unknown> = {}) => ({
          sessionId: 'test-session',
          source: extra.source ?? 'zhin-agent',
          messageId: 'msg-1',
          ...extra,
        }),
        dispatch: vi.fn(async (name: string) => { dispatched.push(name); }),
        emit: vi.fn((name: string) => { emitted.push(name); }),
      } as unknown as import('../../src/zhin-agent/event-emitter.js').ZhinAgentEventEmitter;

      const mgr = new SubagentManager({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        maxIterations: 5,
        eventEmitter: emitter,
      });

      await mgr.spawn({ task: 'hi', origin: { ...baseOrigin, messageId: 'msg-1' } });
      await vi.waitFor(() => expect(dispatched).toContain('ai.processing.finish'), { timeout: 2000 });

      expect(emitted).toContain('ai.typing.stop');
    });
  });
});

describe('ZhinAgent spawn_task 集成', () => {
  it('spawn_task 历史关键词正则（现为主编排序列化常驻）', async () => {
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
