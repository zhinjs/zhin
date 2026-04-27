/**
 * AI Providers 集成测试（真实 API 调用）
 * 
 * 使用 test-bot 的环境配置进行真实 API 测试
 * 
 * 运行方式（需要网络权限）：
 * pnpm test packages/ai/tests/providers.integration.test.ts
 * 
 * 注意：此测试需要网络访问，在 sandbox 中会自动跳过
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { OllamaProvider } from '../../src/ai/providers/ollama.js';
import type { ChatMessage } from '@zhin.js/core';

// Ollama 配置
const OLLAMA_CONFIG = {
  baseUrl: 'https://ollama.l2cl.link',
  models: ['qwen2.5:7b', 'qwen3:8b'],
};

// 全局状态
let canRun = false;
let provider: OllamaProvider | null = null;
/** 从 /api/tags 解析出的、服务端实际存在的模型名（优先列表中的首选） */
let integrationModel = '';

// 跳过检查
const skipIfNoNetwork = (ctx: any) => {
  if (!canRun) {
    ctx.skip();
    return true;
  }
  return false;
};

beforeAll(async () => {
  canRun = false;
  integrationModel = '';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await globalThis.fetch(`${OLLAMA_CONFIG.baseUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      console.log('⚠️ Ollama /api/tags 不可用，跳过集成测试');
      return;
    }
    const data = (await response.json()) as { models?: { name: string }[] };
    const names = (data.models ?? []).map((m) => m.name).filter(Boolean);
    if (!names.length) {
      console.log('⚠️ Ollama 无已拉取模型，跳过集成测试');
      return;
    }
    const nameSet = new Set(names);
    const preferred = OLLAMA_CONFIG.models.find((m) => nameSet.has(m));
    integrationModel = preferred ?? names[0]!;
    provider = new OllamaProvider({
      baseUrl: OLLAMA_CONFIG.baseUrl,
      models: names,
    });
    canRun = true;
    console.log('✅ Ollama 服务可用，测试模型:', integrationModel);
  } catch {
    canRun = false;
    console.log('⚠️ 网络不可用，跳过集成测试');
  }
});

describe('Ollama Provider 集成测试', () => {
  describe('基本聊天', () => {
    it('应该能进行简单对话', async (ctx) => {
      if (skipIfNoNetwork(ctx)) return;

      const response = await provider!.chat({
        model: integrationModel,
        messages: [{ role: 'user', content: '你好，一句话介绍自己' }],
        max_tokens: 100,
      });

      expect(response.choices[0].message.content).toBeTruthy();
      console.log('📝 AI 回复:', response.choices[0].message.content);
    }, 30000);

    it('应该能处理多轮对话', async (ctx) => {
      if (skipIfNoNetwork(ctx)) return;
      
      const messages: ChatMessage[] = [
        { role: 'user', content: '记住：我叫小明。简短回复。' },
      ];

      const r1 = await provider!.chat({
        model: integrationModel,
        messages,
        max_tokens: 30,
      });

      messages.push({ role: 'assistant', content: r1.choices[0].message.content as string });
      messages.push({ role: 'user', content: '我叫什么？' });

      const r2 = await provider!.chat({
        model: integrationModel,
        messages,
        max_tokens: 30,
      });

      const reply = r2.choices[0].message.content as string;
      console.log('📝 多轮对话:', reply);
      expect(reply.toLowerCase()).toContain('小明');
    }, 120000);
  });

  describe('工具调用', () => {
    it('应该能调用计算器工具', async (ctx) => {
      if (skipIfNoNetwork(ctx)) return;
      
      const response = await provider!.chat({
        model: integrationModel,
        messages: [
          { role: 'system', content: '使用 calculator 工具计算。' },
          { role: 'user', content: '计算 15 * 8' },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'calculator',
            description: '计算数学表达式',
            parameters: {
              type: 'object',
              properties: { expression: { type: 'string' } },
              required: ['expression'],
            },
          },
        }],
        tool_choice: 'auto',
        max_tokens: 200,
      });

      console.log('📝 工具调用:', JSON.stringify(response.choices[0].message, null, 2));
      expect(response.choices[0].message).toBeDefined();
    }, 30000);

    it('应该能调用天气工具', async (ctx) => {
      if (skipIfNoNetwork(ctx)) return;
      
      const response = await provider!.chat({
        model: integrationModel,
        messages: [
          { role: 'system', content: '使用 get_weather 工具查天气。' },
          { role: 'user', content: '上海天气？' },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            description: '查询天气',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        }],
        tool_choice: 'auto',
        max_tokens: 200,
      });

      console.log('📝 天气工具测试');
      expect(response.choices[0].message).toBeDefined();
    }, 30000);
  });

  describe('流式输出', () => {
    it('应该能进行流式对话', async (ctx) => {
      if (skipIfNoNetwork(ctx)) return;
      
      const stream = await provider!.chatStream({
        model: integrationModel,
        messages: [{ role: 'user', content: '写4行诗' }],
        max_tokens: 100,
        stream: true,
      });

      let content = '';
      let chunks = 0;

      console.log('📝 流式输出:');
      for await (const chunk of stream) {
        const c = chunk.choices?.[0]?.delta?.content;
        if (c) {
          content += c;
          chunks++;
          process.stdout.write(c);
        }
      }
      console.log(`\n  (${chunks} chunks)`);

      expect(content.length).toBeGreaterThan(0);
    }, 60000);
  });

  describe('错误处理', () => {
    it('应该处理无效模型', async (ctx) => {
      if (skipIfNoNetwork(ctx)) return;
      
      await expect(
        provider!.chat({
          model: 'invalid-model-xyz',
          messages: [{ role: 'user', content: 'test' }],
        })
      ).rejects.toThrow();
    }, 60000); // Ollama 拉取模型可能需要较长时间才会失败
  });

  describe('健康检查', () => {
    it('应该返回健康状态', async (ctx) => {
      if (skipIfNoNetwork(ctx)) return;
      
      const healthy = await provider!.healthCheck();
      console.log('📝 健康:', healthy ? '✅' : '❌');
      expect(typeof healthy).toBe('boolean');
    }, 10000);
  });
});

describe('性能测试', () => {
  it('应该快速响应', async (ctx) => {
    if (skipIfNoNetwork(ctx)) return;
    
    const start = Date.now();
    await provider!.chat({
      model: integrationModel,
      messages: [{ role: 'user', content: '1+1' }],
      max_tokens: 10,
    });
    const ms = Date.now() - start;
    console.log(`📝 响应: ${ms}ms`);
    expect(ms).toBeLessThan(30000);
  }, 35000);
});
