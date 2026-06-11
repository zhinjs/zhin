/**
 * ZhinAgent 补全测试
 * 
 * 测试 collectTools 逻辑、handleMessage 端到端流程、会话管理等
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZhinAgent } from '@zhin.js/agent';
import { Plugin, SkillFeature } from '@zhin.js/core';
import { resetLlmApiRegistryForTests } from '@zhin.js/ai';
import type { AIProvider, AgentTool, ContentPart } from '@zhin.js/core';
import type { Tool, Message } from '@zhin.js/core';

// Mock AIProvider
function createMockProvider(response: string = '你好！'): AIProvider {
  return {
    name: 'mock',
    models: ['mock-model'],
    chat: vi.fn(async () => ({
      choices: [{ message: { role: 'assistant' as const, content: response }, finish_reason: 'stop' }],
    } as ChatResponse)),
    listModels: vi.fn(async () => ['mock-model']),
  };
}

// Mock AIProvider with chatStream support (for multimodal tests)
function createStreamMockProvider(response: string = '你好！'): AIProvider {
  return {
    name: 'mock',
    models: ['mock-model'],
    chat: vi.fn(async () => ({
      choices: [{ message: { role: 'assistant' as const, content: response }, finish_reason: 'stop' }],
    } as ChatResponse)),
    chatStream: vi.fn(async function* () {
      yield {
        id: 'chunk-1',
        object: 'chat.completion.chunk' as const,
        created: Date.now(),
        model: 'mock-model',
        choices: [{ index: 0, delta: { content: response }, finish_reason: null }],
      };
    }),
    listModels: vi.fn(async () => ['mock-model']),
  };
}

function makeCommMessage(overrides: {
  adapter?: string;
  endpoint?: string;
  senderId?: string;
  scope?: 'private' | 'group' | 'channel';
  sceneId?: string;
  extra?: Record<string, unknown>;
  message?: import('@zhin.js/core').Message<any>;
} = {}): import('@zhin.js/core').Message<any> {
  if (overrides.message) return overrides.message;
  const adapter = overrides.adapter ?? 'test';
  const endpoint = overrides.endpoint ?? 'bot1';
  const senderId = overrides.senderId ?? 'user1';
  const scope = overrides.scope ?? 'private';
  const sceneId = overrides.sceneId ?? 'scene1';
  return {
    $adapter: adapter,
    $endpoint: endpoint,
    $sender: { id: senderId },
    $channel: { type: scope, id: sceneId },
    extra: overrides.extra,
  } as import('@zhin.js/core').Message<any>;
}

function makeTool(name: string, desc: string = '', opts: Partial<Tool> = {}): Tool {
  return {
    name,
    description: desc,
    parameters: { type: 'object', properties: {} },
    execute: vi.fn(async () => `result of ${name}`),
    ...opts,
  };
}

function createToolCallProvider(): AIProvider {
  return {
    name: 'mock',
    models: ['mock-model'],
    chat: vi.fn()
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant' as const,
            content: '',
            tool_calls: [{
              id: 'call-1',
              type: 'function' as const,
              function: {
                name: 'tool_search',
                arguments: '{"query":"read_current_time"}',
              },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      } as any)
      .mockResolvedValueOnce({
        choices: [{
          message: { role: 'assistant' as const, content: '工具执行完成' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      } as any),
    listModels: vi.fn(async () => ['mock-model']),
  };
}

describe('ZhinAgent', () => {
  let agent: ZhinAgent;
  let provider: AIProvider;

  beforeEach(() => {
    resetLlmApiRegistryForTests();
    provider = createMockProvider();
    agent = new ZhinAgent(provider, {
      persona: '测试助手',
      maxIterations: 3,
    });
  });

  afterEach(() => {
    agent.dispose();
  });

  describe('构造', () => {
    it('应正确初始化', () => {
      expect(agent).toBeDefined();
    });
  });

  describe('依赖注入', () => {
    it('setSkillRegistry 应正常工作', () => {
      const registry = new SkillFeature();
      expect(() => agent.setSkillRegistry(registry)).not.toThrow();
    });

    it('registerTool 应添加和移除工具', () => {
      const tool: AgentTool = {
        name: 'test_tool',
        description: '测试',
        parameters: { type: 'object', properties: {} },
        execute: async () => 'ok',
      };

      const dispose = agent.registerTool(tool);
      expect(typeof dispose).toBe('function');

      // 移除
      dispose();
    });
  });

  describe('process', () => {
    it('应处理简单文本消息并返回 OutputElement[]', async () => {
      const commMessage = makeCommMessage();

      const result = await agent.process(
        '你好',
        commMessage,
        [],
      );

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(provider.chat).toHaveBeenCalled();
    });

    it('应传递工具列表', async () => {
      const tools: Tool[] = [makeTool('clock_read', '读取当前时间')];
      const commMessage = makeCommMessage();

      await agent.process('现在几点', commMessage, tools);

      // provider.chat 应被调用
      expect(provider.chat).toHaveBeenCalled();
    });

    it('速率限制应生效', async () => {
      // 创建一个严格限制的 agent
      const strictAgent = new ZhinAgent(provider, {
        rateLimit: { maxRequestsPerMinute: 1, cooldownSeconds: 5 },
      });

      const commMessage = makeCommMessage();

      // 第一次请求
      await strictAgent.process('hello', commMessage, []);

      // 第二次应被限制
      const result = await strictAgent.process('hello again', commMessage, []);
      
      // 被限制时应返回友好提示（OutputElement[]）
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);

      strictAgent.dispose();
    });

    it('phaseTrace 开启时应输出可解析 phase 序列', async () => {
      const phases: string[] = [];
      const phaseAgent = new ZhinAgent(provider, {
        phaseTrace: true,
        onPhaseTrace: ({ phase }) => phases.push(phase),
      });
      const commMessage = makeCommMessage();
      try {
        await phaseAgent.process('phase trace', commMessage, []);
        const serialized = phases.map((p) => `phase: ${p}`).join('\n');
        expect(serialized).toContain('phase: turn.start');
        expect(serialized).toContain('phase: tools.collected');
        expect(serialized).toContain('phase: path.agent_loop');
        expect(serialized).toContain('phase: agent_loop.turn.start');
        expect(serialized).toContain('phase: agent_loop.turn.end');
        expect(serialized).toContain('phase: turn.end');
      } finally {
        phaseAgent.dispose();
      }
    });

    it('应将 AI 生命周期桥接到 plugin 事件总线', async () => {
      const toolProvider = createToolCallProvider();
      const busAgent = new ZhinAgent(toolProvider, {
        persona: '测试助手',
        maxIterations: 3,
      });
      const hostPlugin = new Plugin('/virtual/host-plugin.ts');
      const received: string[] = [];
      const payloads: Array<{ event: string; payload: any }> = [];

      const record = (event: string) => (payload: unknown) => {
        received.push(event);
        payloads.push({ event, payload });
      };

      hostPlugin.on('ai.processing.start', record('ai.processing.start'));
      hostPlugin.on('ai.agent.start', record('ai.agent.start'));
      hostPlugin.on('ai.thinking', record('ai.thinking'));
      hostPlugin.on('ai.tool.call', record('ai.tool.call'));
      hostPlugin.on('ai.tool.result', record('ai.tool.result'));
      hostPlugin.on('ai.response', record('ai.response'));
      hostPlugin.on('ai.processing.finish', record('ai.processing.finish'));

      busAgent.setHostPlugin(hostPlugin);

      try {
        await busAgent.process(
          '请调用 tool_search 查找 read_current_time 相关工具',
          makeCommMessage(),
          [makeTool('read_current_time', '读取当前时间并返回当前时刻', {
            keywords: ['read_current_time', '读取当前时间', '当前时间', '时间'],
          })],
        );
      } finally {
        busAgent.dispose();
      }

      expect(received).toContain('ai.processing.start');
      expect(received).toContain('ai.agent.start');
      expect(received).toContain('ai.tool.call');
      expect(received).toContain('ai.tool.result');
      expect(received).toContain('ai.response');
      expect(received).toContain('ai.processing.finish');

      expect(received.indexOf('ai.processing.start')).toBeLessThan(received.indexOf('ai.processing.finish'));
      expect(payloads.find(item => item.event === 'ai.tool.call')?.payload.toolName).toBe('tool_search');
      expect(payloads.find(item => item.event === 'ai.response')?.payload.reply).toContain('工具执行完成');
    });

    it('应将 deferred worker 与 MCP 生命周期桥接到 plugin 事件总线', async () => {
      const bridgeAgent = new ZhinAgent(provider, {
        persona: '测试助手',
        maxIterations: 3,
      });
      const hostPlugin = new Plugin('/virtual/host-plugin.ts');
      const received: string[] = [];
      const payloads: Array<{ event: string; payload: any }> = [];
      const record = (event: string) => (payload: unknown) => {
        received.push(event);
        payloads.push({ event, payload });
      };

      hostPlugin.on('ai.mcp.connect.start', record('ai.mcp.connect.start'));
      hostPlugin.on('ai.mcp.connect.finish', record('ai.mcp.connect.finish'));
      hostPlugin.on('ai.deferred.start', record('ai.deferred.start'));
      hostPlugin.on('ai.deferred.finish', record('ai.deferred.finish'));
      bridgeAgent.setHostPlugin(hostPlugin);
      bridgeAgent.setActiveBinding({
        name: 'zhin',
        providerAlias: 'mock',
        model: 'mock-model',
        mcpServers: ['fs'],
      });
      bridgeAgent.setOrchestrator({
        mcps: {
          getAll: () => [{ name: 'fs' }],
          isConnected: () => false,
          connect: async () => undefined,
          getToolsFromServer: () => [],
          getAllMcpTools: () => [],
        },
      } as any);
      (bridgeAgent as any).deferredWorkerRunner.runSync = vi.fn(async (options: any) => {
        await options.onEvent?.({ phase: 'start', goal: options.goal, loadedToolNames: ['github_star'] });
        await options.onEvent?.({ phase: 'finish', goal: options.goal, loadedToolNames: ['github_star'], status: 'ok', iterations: 1 });
        return { status: 'ok', summary: '{"status":"ok","summary":"done"}', loadedToolNames: ['github_star'] };
      });

      try {
        await bridgeAgent.process('hello', makeCommMessage(), []);
        await (bridgeAgent as any).runDeferredWorker('Check stars', 'github star', makeCommMessage(), [makeTool('bash'), makeTool('github_star')]);
      } finally {
        bridgeAgent.dispose();
      }

      expect(received).toContain('ai.mcp.connect.start');
      expect(received).toContain('ai.mcp.connect.finish');
      expect(received).toContain('ai.deferred.start');
      expect(received).toContain('ai.deferred.finish');
      expect(payloads.find(item => item.event === 'ai.mcp.connect.finish')?.payload.serverName).toBe('fs');
      expect(payloads.find(item => item.event === 'ai.deferred.finish')?.payload.loadedToolNames).toContain('github_star');
    });

    it('应在首次写入会话时发出 ai.session.new', async () => {
      const sessionAgent = new ZhinAgent(provider, {
        persona: '测试助手',
        maxIterations: 3,
      });
      const hostPlugin = new Plugin('/virtual/host-plugin.ts');
      const payloads: any[] = [];
      hostPlugin.on('ai.session.new', payload => payloads.push(payload));
      sessionAgent.setHostPlugin(hostPlugin);

      try {
        await sessionAgent.process('你好', makeCommMessage(), []);
        await sessionAgent.process('再来一次', makeCommMessage(), []);
      } finally {
        sessionAgent.dispose();
      }

      expect(payloads).toHaveLength(1);
      expect(payloads[0].reason).toBe('first_message');
      expect(payloads[0].platform).toBe('test');
      expect(payloads[0].userId).toBe('user1');
    });
  });

  describe('collectTools 去重', () => {
    it('应优先使用 Skill 中的工具', async () => {
      const registry = new SkillFeature();
      
      // 注册一个 Skill 包含 tool_a
      registry.add({
        name: 'skill1',
        description: '技能1',
        tools: [makeTool('tool_a', '来自 skill 的工具', { keywords: ['天气'] })],
        keywords: ['天气'],
        pluginName: 'p1',
      }, 'p1');

      agent.setSkillRegistry(registry);

      // 外部也传入 tool_a（同名）
      const externalTools = [makeTool('tool_a', '来自外部的工具')];
      const commMessage = makeCommMessage();

      // 调用 process，两个同名工具应该只保留一个
      await agent.process('查看天气', commMessage, externalTools);

      // provider.chat 应被调用（正常处理）
      expect(provider.chat).toHaveBeenCalled();
    });
  });

  describe('getUserProfiles', () => {
    it('应返回 UserProfileStore 实例', () => {
      const profiles = agent.getUserProfiles();
      expect(profiles).toBeDefined();
      expect(typeof profiles.get).toBe('function');
      expect(typeof profiles.set).toBe('function');
    });
  });

  describe('dispose', () => {
    it('应正常清理资源', () => {
      expect(() => agent.dispose()).not.toThrow();
    });
  });

  describe('processMultimodal', () => {
    let streamAgent: ZhinAgent;
    let streamProvider: AIProvider;

    beforeEach(() => {
      resetLlmApiRegistryForTests();
      streamProvider = createStreamMockProvider();
      streamAgent = new ZhinAgent(streamProvider, {
        persona: '测试助手',
        maxIterations: 3,
      });
    });

    afterEach(() => {
      streamAgent.dispose();
    });

    it('应处理图片+文本的多模态消息', async () => {
      const commMessage = makeCommMessage();
      const parts: ContentPart[] = [
        { type: 'text', text: '这是什么？' },
        { type: 'image_url', image_url: { url: 'https://example.com/cat.jpg' } },
      ];

      const result = await streamAgent.processMultimodal(parts, commMessage);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('应处理视频类型的多模态消息', async () => {
      const commMessage = makeCommMessage();
      const parts: ContentPart[] = [
        { type: 'text', text: '这个视频讲的是什么？' },
        { type: 'video_url', video_url: { url: 'https://example.com/video.mp4' } },
      ];

      const result = await streamAgent.processMultimodal(parts, commMessage);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('应处理表情类型的多模态消息', async () => {
      const commMessage = makeCommMessage();
      const parts: ContentPart[] = [
        { type: 'text', text: '你好' },
        { type: 'face', face: { id: '178', text: '笑哭' } },
      ];

      const result = await streamAgent.processMultimodal(parts, commMessage);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('应处理混合多种媒体类型的多模态消息', async () => {
      const commMessage = makeCommMessage();
      const parts: ContentPart[] = [
        { type: 'text', text: '看看这些' },
        { type: 'image_url', image_url: { url: 'https://example.com/pic.jpg' } },
        { type: 'video_url', video_url: { url: 'https://example.com/clip.mp4' } },
        { type: 'face', face: { id: '1', text: '微笑' } },
      ];

      const result = await streamAgent.processMultimodal(parts, commMessage);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('无文本时应使用默认描述', async () => {
      const commMessage = makeCommMessage();
      const parts: ContentPart[] = [
        { type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } },
      ];

      const result = await streamAgent.processMultimodal(parts, commMessage);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('速率限制在多模态处理中应生效', async () => {
      const strictAgent = new ZhinAgent(streamProvider, {
        rateLimit: { maxRequestsPerMinute: 1, cooldownSeconds: 5 },
      });

      const commMessage = makeCommMessage();
      const parts: ContentPart[] = [
        { type: 'text', text: '第一次' },
        { type: 'image_url', image_url: { url: 'https://example.com/1.jpg' } },
      ];

      // 第一次
      await strictAgent.processMultimodal(parts, commMessage);

      // 第二次应被限制
      const result = await strictAgent.processMultimodal(parts, commMessage);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);

      strictAgent.dispose();
    });
  });
});
