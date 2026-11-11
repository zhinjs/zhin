/**
 * AI 模块集成测试
 * 
 * 完整测试环境，包括：
 * 1. AI 服务初始化
 * 2. 工具服务功能
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

// Import after mocking
import { AIService } from '@zhin.js/agent';

// ============================================================================
// AI Service 测试
// ============================================================================

describe('AI Service 集成测试', () => {
  let aiService: AIService;

  beforeEach(() => {
    vi.clearAllMocks();
    aiService = new AIService({
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

    it('starts without any model authority and requires explicit Host preparation', () => {
      expect(aiService.isReady()).toBe(false);
      expect(() => aiService.getModelRuntime()).toThrow('not prepared');
      expect(aiService).not.toHaveProperty('getProvider');
      expect(aiService).not.toHaveProperty('listProviders');
    });

    it.each(['providers', 'modelCatalog', 'modelPolicy', 'defaultProvider'])('rejects old %s authority rather than constructing a parallel runtime', key => {
      expect(() => new AIService({ [key]: {} })).toThrow('migration required');
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

  describe('dispose', () => {
    it('应该正确清理资源', async () => {
      await aiService.dispose();
      await expect(aiService.prepareModelRuntime({} as never)).rejects.toThrow('disposed');
    });
  });
});
