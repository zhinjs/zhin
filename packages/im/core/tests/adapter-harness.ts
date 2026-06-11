/**
 * 适配器集成测试工具箱 (Adapter Integration Test Harness)
 *
 * 提供 `createAdapterTestSuite()` 工厂，任何适配器只需提供：
 *   - createAdapter: 创建 Adapter 实例的工厂
 *   - createRawEvent: 创建平台原始消息事件
 *   - adapterName: 适配器标识名
 *   - endpointId: 预期的 Endpoint ID
 *
 * 即可自动获得：
 *   ✅ Endpoint 接口合规性验证
 *   ✅ 生命周期测试 (start → connect → stop → disconnect)
 *   ✅ 消息格式化正确性 ($formatMessage → MessageBase 字段完整)
 *   ✅ 消息发送链路 (sendMessage → endpoint.$sendMessage)
 *   ✅ 消息接收链路 (emit → plugin.dispatch)
 *   ✅ 撤回链路 (call.recallMessage → endpoint.$recallMessage)
 *   ✅ $reply 路由正确性 (走 adapter.sendMessage，不绕过中间件)
 *
 * 用法：
 * ```ts
 * import { createAdapterTestSuite } from '@zhin.js/core/tests/adapter-harness'
 *
 * createAdapterTestSuite({
 *   adapterName: 'my-platform',
 *   endpointId: 'test-bot',
 *   createAdapter: (plugin) => new MyAdapter(plugin, [{ name: 'test-bot', token: 'xxx' }]),
 *   createRawEvent: () => ({ id: '1', content: 'hello', author: { id: 'u1', name: 'User' } }),
 * })
 * ```
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Adapter } from '../src/adapter';
import { Endpoint } from '../src/endpoint.js';
import { getAdapterCapabilities } from '../src/endpoint-capabilities';
import { Plugin } from '../src/plugin';
import { Message, MessageBase } from '../src/message';
import type { SendOptions } from '../src/types';

// ============================================================================
// 类型定义
// ============================================================================

export interface AdapterTestSuiteOptions<
  A extends Adapter = Adapter,
  E extends object = object,
> {
  /** 适配器标识名，用于测试描述和断言 */
  adapterName: string;

  /** 预期的 Endpoint ID（start 后第一个 Endpoint 的 $id） */
  endpointId: string;

  /**
   * 创建适配器实例。
   * 接收一个 Plugin 实例，返回已绑定 plugin 的 Adapter。
   * **注意**：不要在里面调 adapter.start()，harness 会自己调。
   */
  createAdapter: (plugin: Plugin) => A;

  /**
   * 创建一个平台原始消息事件，用于测试 $formatMessage。
   * 返回的对象应能直接传给 endpoint.$formatMessage(event)。
   */
  createRawEvent: () => E;

  /**
   * 可选：创建后对 Endpoint 做额外 mock（如 stub 掉真实网络调用）。
   * 在 adapter.start() 之后、测试开始之前调用。
   */
  setupEndpoint?: (endpoint: Endpoint) => void;

  /**
   * 可选：如果 endpoint.$connect() 需要网络，在这里 mock 掉。
   * 在 adapter.start() 之前调用，可以 vi.spyOn(endpoint, '$connect') 等。
   * 注意：此时 Endpoint 还未创建，请在 createAdapter 内部处理或使用 setupEndpoint。
   */
  beforeStart?: (adapter: A) => void;

  /**
   * 可选：跳过某些测试类别
   */
  skip?: {
    /** 跳过消息发送测试（如适配器不支持发送） */
    send?: boolean;
    /** 跳过消息撤回测试 */
    recall?: boolean;
    /** 跳过 $reply 路由测试 */
    reply?: boolean;
    /** 跳过入站连接测试 */
    connect?: boolean;
  };
}

// ============================================================================
// Test Suite Factory
// ============================================================================

export function createAdapterTestSuite<
  A extends Adapter = Adapter,
  E extends object = object,
>(options: AdapterTestSuiteOptions<A, E>): void {
  const {
    adapterName,
    endpointId,
    createAdapter,
    createRawEvent,
    setupEndpoint,
    beforeStart,
    skip = {},
  } = options;

  const probePlugin = new Plugin('/test/adapter-harness-probe.ts');
  const probeAdapter = createAdapter(probePlugin);
  const adapterCaps = getAdapterCapabilities(probeAdapter);
  const effectiveSkip = {
    send: skip.send ?? !adapterCaps.includes('outbound'),
    recall: skip.recall ?? !adapterCaps.includes('outbound'),
    reply: skip.reply ?? !adapterCaps.includes('outbound'),
    connect: skip.connect ?? !adapterCaps.includes('inbound'),
  };

  describe(`Adapter Integration: ${adapterName}`, () => {
    let plugin: Plugin;
    let adapter: A;
    let endpoint: Endpoint;

    beforeEach(async () => {
      plugin = new Plugin('/test/adapter-harness.ts');
      adapter = createAdapter(plugin);

      if (beforeStart) {
        beforeStart(adapter);
      }

      await adapter.start();

      // 获取第一个 endpoint
      endpoint = adapter.endpoints.get(endpointId)!;
      expect(endpoint).toBeDefined();

      if (setupEndpoint) {
        setupEndpoint(endpoint);
      }
    });

    afterEach(async () => {
      try {
        await adapter.stop();
      } catch {
        // stop 可能因为测试中已 disconnect 而失败，忽略
      }
    });

    // ── Endpoint 接口合规性 ──

    describe('Endpoint 接口合规性', () => {
      it('$id 应为非空字符串', () => {
        expect(typeof endpoint.$id).toBe('string');
        expect(endpoint.$id.length).toBeGreaterThan(0);
      });

      it('$id 应匹配预期值', () => {
        expect(endpoint.$id).toBe(endpointId);
      });

      it('$connected 启动后应为 true', () => {
        expect(endpoint.$connected).toBe(true);
      });

      it('$config 应存在', () => {
        expect(endpoint.$config).toBeDefined();
      });

      it('应实现能力对应的 Endpoint 接口方法', () => {
        if (adapterCaps.includes('inbound')) {
          expect(typeof endpoint.$formatMessage).toBe('function');
          expect(typeof endpoint.$connect).toBe('function');
          expect(typeof endpoint.$disconnect).toBe('function');
        }
        if (adapterCaps.includes('outbound')) {
          expect(typeof endpoint.$sendMessage).toBe('function');
          expect(typeof endpoint.$recallMessage).toBe('function');
        }
      });
    });

    // ── 生命周期 ──

    describe('生命周期', () => {
      it('start() 应将 Endpoint 注册到 endpoints Map', () => {
        expect(adapter.endpoints.has(endpointId)).toBe(true);
      });

      it('start() 应将适配器名注册到 plugin.root.adapters', () => {
        expect(plugin.root.adapters).toContain(adapter.name);
      });

      it('stop() 应断开所有 Endpoint', async () => {
        await adapter.stop();
        expect(adapter.endpoints.size).toBe(0);
      });

      it('stop() 应从 adapters 中移除', async () => {
        await adapter.stop();
        expect(plugin.root.adapters).not.toContain(adapter.name);
      });

      it('重复 start/stop 不应崩溃', async () => {
        await adapter.stop();
        // 重新创建以测试二次启动
        adapter = createAdapter(plugin);
        if (beforeStart) beforeStart(adapter);
        await adapter.start();
        const newEndpoint = adapter.endpoints.get(endpointId);
        expect(newEndpoint).toBeDefined();
        expect(newEndpoint!.$connected).toBe(true);
      });
    });

    // ── 消息格式化 ──

    describe('$formatMessage 消息格式化', () => {
      let message: Message;

      beforeEach(() => {
        const rawEvent = createRawEvent();
        message = endpoint.$formatMessage(rawEvent);
      });

      it('应返回包含 $id 的消息', () => {
        expect(typeof message.$id).toBe('string');
        expect(message.$id.length).toBeGreaterThan(0);
      });

      it('$adapter 应匹配适配器名', () => {
        expect(message.$adapter).toBe(adapterName);
      });

      it('$endpoint 应为字符串', () => {
        expect(typeof message.$endpoint).toBe('string');
      });

      it('$content 应为数组', () => {
        expect(Array.isArray(message.$content)).toBe(true);
      });

      it('$content 元素应有 type 和 data', () => {
        for (const el of message.$content) {
          expect(typeof el.type).toBe('string');
          expect(el.data).toBeDefined();
        }
      });

      it('$sender 应有 id', () => {
        expect(typeof message.$sender.id).toBe('string');
      });

      it('$channel 应有 id 和 type', () => {
        expect(typeof message.$channel.id).toBe('string');
        expect(['group', 'private', 'channel']).toContain(message.$channel.type);
      });

      it('$timestamp 应为正整数', () => {
        expect(typeof message.$timestamp).toBe('number');
        expect(message.$timestamp).toBeGreaterThan(0);
      });

      it('$raw 应为字符串', () => {
        expect(typeof message.$raw).toBe('string');
      });

      if (adapterCaps.includes('outbound')) {
        it('$reply 应为函数', () => {
          expect(typeof message.$reply).toBe('function');
        });

        it('$recall 应为函数', () => {
          expect(typeof message.$recall).toBe('function');
        });
      }
    });

    // ── 消息接收链路 ──

    describe('消息接收链路', () => {
      it('emit message.receive 应触发 plugin.dispatch', async () => {
        const dispatchSpy = vi.spyOn(plugin, 'dispatch');
        const rawEvent = createRawEvent();
        const message = endpoint.$formatMessage(rawEvent);

        adapter.emit('message.receive', message);
        // 等待异步处理完成
        await new Promise(r => setTimeout(r, 50));

        expect(dispatchSpy).toHaveBeenCalledWith(
          'message.receive',
          expect.objectContaining({ $adapter: adapterName }),
        );
        dispatchSpy.mockRestore();
      });

      it('adapter.on 观察者应收到消息', async () => {
        const observer = vi.fn();
        adapter.on('message.receive', observer);

        const rawEvent = createRawEvent();
        const message = endpoint.$formatMessage(rawEvent);
        adapter.emit('message.receive', message);
        await new Promise(r => setTimeout(r, 50));

        expect(observer).toHaveBeenCalledTimes(1);
      });
    });

    // ── 消息发送链路 ──

    if (!effectiveSkip.send) {
      describe('消息发送链路', () => {
        it('sendMessage 应调用 endpoint.$sendMessage', async () => {
          const sendSpy = vi.spyOn(endpoint, '$sendMessage');

          const options: SendOptions = {
            context: adapterName,
            endpoint: endpointId,
            id: 'target-1',
            type: 'private',
            content: [{ type: 'text', data: { text: 'hello' } }],
          };

          await adapter.sendMessage(options);
          expect(sendSpy).toHaveBeenCalledTimes(1);
          sendSpy.mockRestore();
        });

        it('sendMessage 应返回消息 ID 字符串', async () => {
          const options: SendOptions = {
            context: adapterName,
            endpoint: endpointId,
            id: 'target-1',
            type: 'private',
            content: [{ type: 'text', data: { text: 'hello' } }],
          };

          const result = await adapter.sendMessage(options);
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);
        });

        it('sendMessage Endpoint 不存在应抛错', async () => {
          const options: SendOptions = {
            context: adapterName,
            endpoint: 'non-existent-endpoint',
            id: 'target-1',
            type: 'private',
            content: [],
          };

          await expect(adapter.sendMessage(options)).rejects.toThrow(/not found/i);
        });

        it('before.sendMessage 中间件应被调用', async () => {
          const middleware = vi.fn((opts: SendOptions) => opts);
          plugin.root.on('before.sendMessage', middleware);

          const options: SendOptions = {
            context: adapterName,
            endpoint: endpointId,
            id: 'target-1',
            type: 'private',
            content: [{ type: 'text', data: { text: 'test' } }],
          };

          await adapter.sendMessage(options);
          expect(middleware).toHaveBeenCalledTimes(1);
          plugin.root.removeListener('before.sendMessage', middleware);
        });
      });
    }

    // ── 消息撤回 ──

    if (!effectiveSkip.recall) {
      describe('消息撤回', () => {
        it('call.recallMessage 应调用 endpoint.$recallMessage', async () => {
          const recallSpy = vi.spyOn(endpoint, '$recallMessage');
          adapter.emit('call.recallMessage', endpointId, 'msg-123');
          await new Promise(r => setTimeout(r, 50));

          expect(recallSpy).toHaveBeenCalledWith('msg-123');
          recallSpy.mockRestore();
        });
      });
    }

    // ── $reply 路由正确性 ──

    if (!effectiveSkip.reply) {
      describe('$reply 路由', () => {
        it('$reply 应走 adapter.sendMessage 而非绕过', async () => {
          const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
          const rawEvent = createRawEvent();
          const message = endpoint.$formatMessage(rawEvent);
          expect(message.$reply).toBeTypeOf('function');

          // 用 spy 替代真实发送
          sendMessageSpy.mockResolvedValue('reply-id');

          const result = await message.$reply!('hi');
          expect(sendMessageSpy).toHaveBeenCalledTimes(1);
          expect(result).toBe('reply-id');
          sendMessageSpy.mockRestore();
        });
      });
    }
  });
}

// ============================================================================
// 辅助：快速创建 Mock 适配器用于测试 harness 本身
// ============================================================================

export class HarnessTestEndpoint implements Endpoint<{ name: string }, { id: string; text: string; from: string }> {
  $id: string;
  $connected = false;

  constructor(
    public adapter: Adapter,
    public $config: { name: string },
  ) {
    this.$id = $config.name;
  }

  $formatMessage(event: { id: string; text: string; from: string }): Message<typeof event> {
    const base: MessageBase = {
      $id: event.id,
      $adapter: this.adapter.name as any,
      $endpoint: this.$id,
      $content: [{ type: 'text', data: { text: event.text } }],
      $sender: { id: event.from, name: event.from },
      $channel: { id: 'ch-1', type: 'private' },
      $timestamp: Date.now(),
      $raw: event.text,
      $reply: async (content: any) => {
        return await this.adapter.sendMessage({
          context: this.adapter.name,
          endpoint: this.$id,
          content: Array.isArray(content) ? content : [{ type: 'text', data: { text: String(content) } }],
          id: 'ch-1',
          type: 'private',
        });
      },
      $recall: async () => {
        await this.$recallMessage(event.id);
      },
    };
    return Message.from(event, base);
  }

  async $connect() { this.$connected = true; }
  async $disconnect() { this.$connected = false; }
  async $sendMessage(_options: SendOptions) { return `sent-${Date.now()}`; }
  async $recallMessage(_id: string) {}
}

export class HarnessTestAdapter extends Adapter<HarnessTestEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;

  createEndpoint(config: { name: string }): HarnessTestEndpoint {
    return new HarnessTestEndpoint(this, config);
  }
}
