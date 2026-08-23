/**
 * ZhinAgent 补全测试
 * 
 * 测试 collectTools 逻辑、handleMessage 端到端流程、会话管理等
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZhinAgent } from '@zhin.js/agent';
import { Plugin, SkillFeature, type AIProvider, type AgentTool, type Tool } from '@zhin.js/core';
import { resetLlmApiRegistryForTests } from '@zhin.js/ai';
import { wireMockLlmApi, assistantTextReply, type MockLlmApi } from '../helpers/mock-llm-api.js';


// Mock LLM（ai-sdk 原生面）
function createMockProvider(response: string = '你好！'): { provider: AIProvider; llm: MockLlmApi } {
  const llm = wireMockLlmApi({ responder: () => assistantTextReply(response) });
  const provider = Object.assign(llm.provider, {
    listModels: vi.fn(async () => ['mock-model']),
  }) as unknown as AIProvider;
  return { provider, llm };
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
                name: 'read_current_time',
                arguments: '{}',
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
  let llm: MockLlmApi;

  beforeEach(() => {
    resetLlmApiRegistryForTests();
    ({ provider, llm } = createMockProvider());
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
    it('configure({ skillRegistry }) 应正常工作', () => {
      const registry = new SkillFeature();
      expect(() => agent.configure({ skillRegistry: registry })).not.toThrow();
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
      expect(llm.calls.length).toBeGreaterThan(0);
    });

    it('应传递工具列表', async () => {
      const tools: Tool[] = [makeTool('clock_read', '读取当前时间')];
      const commMessage = makeCommMessage();

      await agent.process('现在几点', commMessage, tools);

      // provider.chat 应被调用
      expect(llm.calls.length).toBeGreaterThan(0);
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
      const busAgent = new ZhinAgent(provider, {
        persona: '测试助手',
        maxIterations: 3,
      });
      const hostPlugin = new Plugin('/virtual/host-plugin.ts');
      const received: string[] = [];

      const record = (event: string) => () => {
        received.push(event);
      };

      hostPlugin.on('ai.processing.start', record('ai.processing.start'));
      hostPlugin.on('ai.agent.start', record('ai.agent.start'));
      hostPlugin.on('ai.response', record('ai.response'));
      hostPlugin.on('ai.processing.finish', record('ai.processing.finish'));

      busAgent.configure({ hostPlugin });

      try {
        await busAgent.process(
          '你好',
          makeCommMessage(),
          [],
        );
      } finally {
        busAgent.dispose();
      }

      expect(received).toContain('ai.processing.start');
      expect(received).toContain('ai.response');
      expect(received).toContain('ai.processing.finish');
      expect(received.indexOf('ai.processing.start')).toBeLessThan(received.indexOf('ai.processing.finish'));
    });

    it('应在首次写入会话时发出 ai.session.new', async () => {
      const sessionAgent = new ZhinAgent(provider, {
        persona: '测试助手',
        maxIterations: 3,
      });
      const hostPlugin = new Plugin('/virtual/host-plugin.ts');
      const payloads: any[] = [];
      hostPlugin.on('ai.session.new', payload => payloads.push(payload));
      sessionAgent.configure({ hostPlugin });

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

      agent.configure({ skillRegistry: registry });

      // 外部也传入 tool_a（同名）
      const externalTools = [makeTool('tool_a', '来自外部的工具')];
      const commMessage = makeCommMessage();

      // 调用 process，两个同名工具应该只保留一个
      await agent.process('查看天气', commMessage, externalTools);

      // provider.chat 应被调用（正常处理）
      expect(llm.calls.length).toBeGreaterThan(0);
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

    it('并发 dispose 应共享同一关闭完成', async () => {
      let release!: () => void;
      const dispose = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
      agent.subagentSystem = { dispose } as unknown as import('../../src/subagent/subagent-system.js').SubagentSystem;

      const first = agent.dispose();
      let secondSettled = false;
      const repeated = agent.dispose();
      expect(repeated).toBe(first);
      const second = repeated.then(() => { secondSettled = true; });
      await Promise.resolve();
      expect(secondSettled).toBe(false);
      expect(dispose).toHaveBeenCalledTimes(1);
      release();
      await Promise.all([first, second]);
    });
  });
});
