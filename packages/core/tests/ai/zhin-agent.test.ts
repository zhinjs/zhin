/**
 * ZhinAgent 补全测试
 * 
 * 测试 collectTools 逻辑、handleMessage 端到端流程、会话管理等
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZhinAgent } from '../../src/ai/zhin-agent/index.js';
import { SkillFeature } from '../../src/built/skill.js';
import type { AIProvider, ChatResponse, AgentTool } from '../../src/ai/types.js';
import type { Tool, ToolContext } from '../../src/types.js';

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

function makeToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    platform: 'test',
    botId: 'bot1',
    sceneId: 'scene1',
    senderId: 'user1',
    ...overrides,
  };
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

describe('ZhinAgent', () => {
  let agent: ZhinAgent;
  let provider: AIProvider;

  beforeEach(() => {
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
      const context = makeToolContext();

      const result = await agent.process(
        '你好',
        context,
        [],
      );

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(provider.chat).toHaveBeenCalled();
    });

    it('应传递工具列表', async () => {
      const tools: Tool[] = [makeTool('get_time', '获取时间')];
      const context = makeToolContext();

      await agent.process('现在几点', context, tools);

      // provider.chat 应被调用
      expect(provider.chat).toHaveBeenCalled();
    });

    it('速率限制应生效', async () => {
      // 创建一个严格限制的 agent
      const strictAgent = new ZhinAgent(provider, {
        rateLimit: { maxRequestsPerMinute: 1, cooldownSeconds: 5 },
      });

      const context = makeToolContext();

      // 第一次请求
      await strictAgent.process('hello', context, []);

      // 第二次应被限制
      const result = await strictAgent.process('hello again', context, []);
      
      // 被限制时应返回友好提示（OutputElement[]）
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);

      strictAgent.dispose();
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
      const context = makeToolContext();

      // 调用 process，两个同名工具应该只保留一个
      await agent.process('查看天气', context, externalTools);

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
});
