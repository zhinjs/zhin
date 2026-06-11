import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Endpoint } from '../src/endpoint.js';
import type { SendOptions } from '../src/types.js';
import { Message } from '../src/message.js';

describe('Endpoint 接口测试', () => {
  class TestEndpoint implements Endpoint {
    $id = 'test-endpoint';
    $connected = false;
    $config: Endpoint.Config;

    constructor(config: Endpoint.Config) {
      this.$config = config;
    }

    async $connect(): Promise<void> {
      this.$connected = true;
    }

    async $disconnect(): Promise<void> {
      this.$connected = false;
    }

    async $sendMessage(_options: SendOptions): Promise<string> {
      if (!this.$connected) {
        throw new Error('Endpoint 未连接');
      }
      return '123';
    }

    async $recallMessage(_id: string): Promise<void> {}

    $formatMessage(message: unknown): Message {
      return message as Message;
    }
  }

  let endpoint: TestEndpoint;
  let testConfig: Endpoint.Config;

  beforeEach(() => {
    testConfig = {
      name: '测试 Endpoint',
      context: 'test',
    };
    endpoint = new TestEndpoint(testConfig);
  });

  describe('基本属性测试', () => {
    it('应该正确设置配置', () => {
      expect(endpoint.$config).toEqual(testConfig);
    });

    it('应该正确初始化连接状态', () => {
      expect(endpoint.$connected).toBe(false);
    });
  });

  describe('连接管理测试', () => {
    it('应该正确处理连接', async () => {
      await endpoint.$connect();
      expect(endpoint.$connected).toBe(true);
    });

    it('应该正确处理断开连接', async () => {
      await endpoint.$connect();
      await endpoint.$disconnect();
      expect(endpoint.$connected).toBe(false);
    });
  });

  describe('消息发送测试', () => {
    it('未连接时应该抛出错误', async () => {
      const options: SendOptions = {
        id: '123',
        type: 'group',
        context: 'test',
        endpoint: 'test-endpoint',
        content: '测试消息',
      };

      await expect(endpoint.$sendMessage(options)).rejects.toThrow('Endpoint 未连接');
    });

    it('连接后应该正确发送消息', async () => {
      const options: SendOptions = {
        id: '123',
        type: 'group',
        context: 'test',
        endpoint: 'test-endpoint',
        content: '测试消息',
      };

      const sendSpy = vi.spyOn(endpoint, '$sendMessage');
      await endpoint.$connect();
      await endpoint.$sendMessage(options);
      expect(sendSpy).toHaveBeenCalledWith(options);
    });
  });

  describe('自定义配置测试', () => {
    it('应该支持扩展的配置类型', () => {
      interface ExtendedConfig extends Endpoint.Config {
        token: string;
        platform: string;
      }

      class ExtendedEndpoint implements Endpoint<ExtendedConfig> {
        $id = 'extended';
        $connected = false;
        $config: ExtendedConfig;

        constructor(config: ExtendedConfig) {
          this.$config = config;
        }

        async $connect(): Promise<void> {
          this.$connected = true;
        }

        async $disconnect(): Promise<void> {
          this.$connected = false;
        }

        async $sendMessage(_options: SendOptions): Promise<string> {
          if (!this.$connected) throw new Error('Endpoint 未连接');
          return '123';
        }

        async $recallMessage(_id: string): Promise<void> {}

        $formatMessage(message: unknown): Message {
          return message as Message;
        }
      }

      const extendedConfig: ExtendedConfig = {
        name: '扩展 Endpoint',
        context: 'extended',
        token: 'test-token',
        platform: 'test-platform',
      };

      const extended = new ExtendedEndpoint(extendedConfig);
      expect(extended.$config).toEqual(extendedConfig);
      expect(extended.$config.token).toBe('test-token');
      expect(extended.$config.platform).toBe('test-platform');
    });
  });
});
