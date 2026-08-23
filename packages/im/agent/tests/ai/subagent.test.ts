/**
 * SubagentRuntime 测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetLlmApiRegistryForTests } from '@zhin.js/ai';
import { wireMockLlmApi, assistantTextReply, type MockLlmApi } from '../helpers/mock-llm-api.js';
import { SubagentRuntime, type SubagentOrigin, type SpawnOptions } from '@zhin.js/agent';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import type { ZhinAgentEventEmitter } from '../../src/event/event-emitter.js';

import type { AgentTool } from '@zhin.js/core';

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
  const llm = wireMockLlmApi({ responder: () => assistantTextReply(response) });
  const provider = Object.assign(llm.provider, {
    listModels: vi.fn(async () => ['mock-model']),
  });
  return { provider, llm };
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

describe('SubagentRuntime', () => {
  let manager: SubagentRuntime;
  let provider: ReturnType<typeof createMockProvider>['provider'];
  let llm: MockLlmApi;
  let mockTools: AgentTool[];
  let onSubagentComplete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetLlmApiRegistryForTests();
    ({ provider, llm } = createMockProvider());
    mockTools = createMockTools();
    onSubagentComplete = vi.fn().mockResolvedValue(undefined);
    manager = new SubagentRuntime({
      provider: provider as any,
      workspace: '/tmp/test-workspace',
      createTools: () => mockTools,
      maxIterations: 5,
      onSubagentComplete,
    });
  });

  afterEach(async () => {
    await manager.dispose();
  });

  describe('spawn', () => {
    it('dispose during async enrichment must fail closed before starting work', async () => {
      let releaseMeta!: () => void;
      const enrichment = new Promise<void>((resolve) => { releaseMeta = resolve; });
      const guarded = new SubagentRuntime({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        resolveAgentMeta: async () => {
          await enrichment;
          return null;
        },
      });

      const spawning = guarded.spawn({ task: 'late', agent: 'worker', origin: baseOrigin });
      await Promise.resolve();
      const disposal = guarded.dispose();
      releaseMeta();

      await disposal;
      await expect(spawning).rejects.toThrow(/disposed|retired|aborted/i);
      expect(llm.calls).toHaveLength(0);
    });

    it('dispose during spawn observer must abort before entering agent loop', async () => {
      let releaseSpawn!: () => void;
      let spawnObserved!: () => void;
      const observed = new Promise<void>((resolve) => { spawnObserved = resolve; });
      const guarded = new SubagentRuntime({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        onEvent: async (event) => {
          if (event.phase !== 'spawn') return;
          spawnObserved();
          await new Promise<void>((resolve) => { releaseSpawn = resolve; });
        },
      });

      const spawning = guarded.spawn({ task: 'late', origin: baseOrigin });
      await observed;
      const disposal = guarded.dispose();
      releaseSpawn();

      await disposal;
      await expect(spawning).rejects.toThrow(/disposed|retired|aborted/i);
      expect(llm.calls).toHaveLength(0);
    });
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
      llm.hang();

      expect(manager.getRunningCount()).toBe(0);

      await manager.spawn({ task: '任务1', origin: baseOrigin });

      // 异步启动后应有 1 个运行中的任务
      expect(manager.getRunningCount()).toBe(1);
    });

    it('应触发生命周期事件回调', async () => {
      const onEvent = vi.fn();
      const eventManager = new SubagentRuntime({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        maxIterations: 5,
        onEvent,
        onSubagentComplete: vi.fn().mockResolvedValue(undefined),
      });

      await eventManager.spawn({ task: '分析 README', label: 'README分析', origin: baseOrigin });
      await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ phase: 'finish' })), { timeout: 2000 });

      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ phase: 'spawn', label: 'README分析' }));
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ phase: 'start', label: 'README分析' }));
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ phase: 'finish', label: 'README分析', status: 'ok' }));
      expect(onEvent.mock.calls.map(([event]) => event.phase)).toEqual(['spawn', 'start', 'finish']);

      eventManager.dispose();
    });
  });

  describe('工具过滤', () => {
    it('子 agent 应只获得白名单内的工具', async () => {
      await manager.spawn({ task: '读取文件写入并搜索网页', origin: baseOrigin });

      await vi.waitFor(() => expect(onSubagentComplete).toHaveBeenCalled(), { timeout: 2000 });

      // 断言面：LLM 调用 context（AgentMessage 层）携带的工具列表
      const call = llm.calls[0];
      const toolNames = (call?.context.tools ?? []).map((t) => t.name);
      expect(toolNames).toContain('read_file');
      expect(toolNames).not.toContain('spawn_task');
      expect(toolNames).not.toContain('discover');
    });

    it('子 agent 仅从显式授权集合中按任务 TF-IDF 载入工具', async () => {
      const extraTool = {
        name: 'todo_write',
        description: 'todo list',
        parameters: { type: 'object', properties: {} },
        keywords: ['todo', '任务', '清单'],
        execute: async () => 'ok',
      };
      const onComplete = vi.fn().mockResolvedValue(undefined);
      const customManager = new SubagentRuntime({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => [...mockTools, extraTool],
        execPolicyConfig: { ...DEFAULT_CONFIG, subagentTools: ['todo_write'] },
        onSubagentComplete: onComplete,
      });

      await customManager.spawn({ task: '帮我列一份 todo 任务清单', origin: baseOrigin });
      await vi.waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 2000 });

      const toolNames = (llm.calls[0]?.context.tools ?? []).map((t) => t.name);
      expect(toolNames).toContain('todo_write');
      customManager.dispose();
    });
  });

  describe('结果回告', () => {
    it('完成后应先交给 onSubagentComplete（主 agent 路径）', async () => {
      await manager.spawn({ task: '读取 README', label: '读README', origin: baseOrigin });

      await vi.waitFor(() => expect(onSubagentComplete).toHaveBeenCalled(), { timeout: 2000 });

      expect(onSubagentComplete).toHaveBeenCalledTimes(1);
      const payload = onSubagentComplete.mock.calls[0]![0];
      expect(payload.origin).toEqual(baseOrigin);
      expect(payload.label).toBe('读README');
      expect(payload.status).toBe('ok');
      expect(payload.result).toContain('任务完成');
    });

    it('subagentDirectImDelivery 时可额外通过 sender 直发 IM', async () => {
      const sender = vi.fn();
      manager.setSender(sender);

      await manager.spawn({ task: '读取 README', label: '读README', origin: baseOrigin });

      await vi.waitFor(() => expect(sender).toHaveBeenCalled(), { timeout: 2000 });

      expect(onSubagentComplete).toHaveBeenCalledTimes(1);
      expect(sender).toHaveBeenCalledTimes(1);
      const [origin, delivery] = sender.mock.calls[0]!;
      expect(origin).toEqual(baseOrigin);
      expect(delivery.text).toContain('读README');
      expect(delivery.text).toContain('完成');
    });

    it('provider 错误时仍应交给 onSubagentComplete', async () => {
      llm.fail(new Error('API 调用失败'));

      await manager.spawn({ task: '会失败的任务', label: '失败测试', origin: baseOrigin });

      await vi.waitFor(() => expect(onSubagentComplete).toHaveBeenCalled(), { timeout: 2000 });

      const payload = onSubagentComplete.mock.calls[0]![0];
      expect(payload.status).toBe('ok');
      expect(payload.result).toContain('API 调用失败');
    });

    it('onSubagentComplete 不阻塞 subagent 清理，避免与主回合 waitForIdle 死锁', async () => {
      let releaseComplete!: () => void;
      const completeGate = new Promise<void>((resolve) => {
        releaseComplete = resolve;
      });
      const blockingComplete = vi.fn(async () => {
        await completeGate;
      });
      const blockingManager = new SubagentRuntime({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        maxIterations: 5,
        onSubagentComplete: blockingComplete,
      });

      await blockingManager.spawn({ task: '快速任务', origin: baseOrigin });

      await vi.waitFor(() => expect(blockingManager.getRunningCount()).toBe(0), { timeout: 2000 });
      expect(blockingComplete).toHaveBeenCalledTimes(1);

      releaseComplete();
      await completeGate;
      blockingManager.dispose();
    });

    it('无 onSubagentComplete 时不应崩溃', async () => {
      const bare = new SubagentRuntime({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        maxIterations: 5,
      });
      await bare.spawn({ task: '测试', origin: baseOrigin });

      await new Promise(r => setTimeout(r, 200));
      expect(bare.getRunningCount()).toBe(0);
      bare.dispose();
    });
  });

  describe('完成后清理', () => {
    it('完成后应从 runningTasks 移除', async () => {
      await manager.spawn({ task: '快速任务', origin: baseOrigin });

      await vi.waitFor(() => expect(onSubagentComplete).toHaveBeenCalled(), { timeout: 2000 });

      expect(manager.getRunningCount()).toBe(0);
    });

    it('失败后也应从 runningTasks 移除', async () => {
      llm.fail(new Error('boom'));

      await manager.spawn({ task: '会失败', origin: baseOrigin });

      await vi.waitFor(() => expect(onSubagentComplete).toHaveBeenCalled(), { timeout: 2000 });

      expect(manager.getRunningCount()).toBe(0);
    });

    it('cancel 应中断挂起的 agent loop 并产生错误终态', async () => {
      llm.hang();
      const dispatched: string[] = [];
      const emitted: string[] = [];
      const emitter = {
        createPayload: (_sid: string, _ctx: unknown, _mode: string, extra: Record<string, unknown> = {}) => ({
          sessionId: 'test-session', messageId: 'msg-1', ...extra,
        }),
        dispatch: vi.fn(async (name: string) => { dispatched.push(name); }),
        emit: vi.fn((name: string) => { emitted.push(name); }),
      } as unknown as ZhinAgentEventEmitter;
      manager.setEventEmitter(emitter);

      const confirmation = await manager.spawn({ task: '挂起任务', origin: baseOrigin });
      const taskId = confirmation.match(/id: ([^)]+)/)?.[1];
      expect(taskId).toBeTruthy();
      await vi.waitFor(() => expect(llm.calls).toHaveLength(1));
      expect(manager.cancel(taskId!)).toBe(true);

      await vi.waitFor(() => expect(onSubagentComplete).toHaveBeenCalledTimes(1));
      expect(onSubagentComplete.mock.calls[0]![0].status).toBe('error');
      expect(dispatched).toContain('ai.processing.error');
      expect(emitted).toContain('ai.typing.stop');
      expect(manager.getRunningCount()).toBe(0);
    });
  });

  describe('dispose', () => {
    it('应清空 runningTasks', () => {
      manager.dispose();
      expect(manager.getRunningCount()).toBe(0);
    });

    it('dispose 中断子任务时只发终态清理，不再投递旧 generation 结果', async () => {
      llm.hang();
      const dispatched: string[] = [];
      const emitter = {
        createPayload: (_sid: string, _ctx: unknown, _mode: string, extra: Record<string, unknown> = {}) => ({
          sessionId: 'test-session', messageId: 'msg-1', ...extra,
        }),
        dispatch: vi.fn(async (name: string) => { dispatched.push(name); }),
        emit: vi.fn(),
      } as unknown as ZhinAgentEventEmitter;
      manager.setEventEmitter(emitter);
      await manager.spawn({ task: '退役时挂起', origin: baseOrigin });
      await vi.waitFor(() => expect(llm.calls).toHaveLength(1));

      manager.dispose();
      await vi.waitFor(() => expect(dispatched).toContain('ai.processing.error'));

      expect(onSubagentComplete).not.toHaveBeenCalled();
      expect(manager.getRunningCount()).toBe(0);
    });

    it('dispose 应等待已跟踪任务的 terminal observer 完成', async () => {
      llm.hang();
      let finishEntered!: () => void;
      let releaseFinish!: () => void;
      const entered = new Promise<void>((resolve) => { finishEntered = resolve; });
      const guarded = new SubagentRuntime({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        onEvent: async (event) => {
          if (event.phase !== 'finish') return;
          finishEntered();
          await new Promise<void>((resolve) => { releaseFinish = resolve; });
        },
      });
      await guarded.spawn({ task: 'tracked', origin: baseOrigin });
      await vi.waitFor(() => expect(llm.calls).toHaveLength(1));

      let settled = false;
      const disposal = Promise.resolve(guarded.dispose()).then(() => { settled = true; });
      await entered;
      expect(settled).toBe(false);
      releaseFinish();
      await disposal;
      expect(settled).toBe(true);
    });

    it('processingStart observer 内 dispose 不 self-wait，但外部 dispose 仍等 terminal', async () => {
      const holder: { current?: SubagentRuntime } = {};
      let finishEntered!: () => void;
      let releaseFinish!: () => void;
      const entered = new Promise<void>((resolve) => { finishEntered = resolve; });
      let observerDisposeReturned = false;
      const emitter = {
        createPayload: (_sid: string, _ctx: unknown, _mode: string, extra: Record<string, unknown> = {}) => ({
          sessionId: 'test-session', messageId: 'msg-1', ...extra,
        }),
        dispatch: vi.fn(async (name: string) => {
          if (name === 'ai.processing.start') {
            await holder.current!.dispose();
            observerDisposeReturned = true;
          }
        }),
        emit: vi.fn(),
      } as unknown as ZhinAgentEventEmitter;
      const guarded = new SubagentRuntime({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        eventEmitter: emitter,
        onEvent: async (event) => {
          if (event.phase !== 'finish') return;
          finishEntered();
          await new Promise<void>((resolve) => { releaseFinish = resolve; });
        },
      });
      holder.current = guarded;

      await guarded.spawn({ task: 'dispose-from-processing-start', origin: baseOrigin });
      await entered;
      expect(observerDisposeReturned).toBe(true);
      let externalSettled = false;
      const external = guarded.dispose().then(() => { externalSettled = true; });
      await Promise.resolve();
      expect(externalSettled).toBe(false);
      releaseFinish();
      await external;
    });

    it('finish observer 内 dispose 排除当前 task，不与自身 settlement 死锁', async () => {
      const holder: { current?: SubagentRuntime } = {};
      let finishDisposeReturned = false;
      const guarded = new SubagentRuntime({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        onEvent: async (event) => {
          if (event.phase !== 'finish') return;
          await holder.current!.dispose();
          finishDisposeReturned = true;
        },
      });
      holder.current = guarded;

      await guarded.spawn({ task: 'dispose-from-finish', origin: baseOrigin });
      await vi.waitFor(() => expect(finishDisposeReturned).toBe(true));
      await guarded.dispose();
      expect(guarded.getRunningCount()).toBe(0);
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

      const mgr = new SubagentRuntime({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        maxIterations: 5,
        eventEmitter: emitter,
        onSubagentComplete: vi.fn().mockResolvedValue(undefined),
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
      } as unknown as import('../../src/event/event-emitter.js').ZhinAgentEventEmitter;

      const mgr = new SubagentRuntime({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        maxIterations: 5,
        eventEmitter: emitter,
        onSubagentComplete: vi.fn().mockResolvedValue(undefined),
      });

      await mgr.spawn({ task: 'hi', origin: { ...baseOrigin, messageId: 'msg-1' } });
      await vi.waitFor(() => expect(dispatched).toContain('ai.processing.finish'), { timeout: 2000 });

      expect(emitted).toContain('ai.typing.stop');
    });
  });

  describe('maxParallelSubagents cap', () => {
    it('rejects spawn when at capacity', async () => {
      llm.hang();
      const capped = new SubagentRuntime({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        maxIterations: 5,
        maxParallelSubagents: 1,
      });
      await capped.spawn({ task: 'task-1', origin: baseOrigin });
      expect(capped.getRunningCount()).toBe(1);
      const rejected = await capped.spawn({ task: 'task-2', origin: baseOrigin });
      expect(rejected).toContain('并行子代理已达上限');
      capped.dispose();
    });

    it('spawnSync rejects when at capacity', async () => {
      llm.hang();
      const capped = new SubagentRuntime({
        provider: provider as any,
        workspace: '/tmp/test-workspace',
        createTools: () => mockTools,
        maxIterations: 5,
        maxParallelSubagents: 1,
        onSubagentComplete: vi.fn().mockResolvedValue(undefined),
      });
      void capped.spawn({ task: 'bg task', origin: baseOrigin });
      await vi.waitFor(() => expect(capped.getRunningCount()).toBe(1));
      const rejected = await capped.spawnSync({ task: 'sync task', origin: baseOrigin });
      expect(rejected).toContain('并行子代理已达上限');
      capped.dispose();
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
