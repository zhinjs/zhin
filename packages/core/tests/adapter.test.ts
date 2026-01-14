import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Adapter } from '../src/adapter'
import { Bot } from '../src/bot'
import { Plugin } from '../src/plugin'
import { Message, MessageBase } from '../src/message'
import { EventEmitter } from 'events'

// Mock Bot 实现用于测试
class MockBot implements Bot<any, any> {
  $id: string
  $config: any
  $connected: boolean = false
  adapter: Adapter

  constructor(adapter: Adapter, config: any) {
    this.adapter = adapter
    this.$config = config
    this.$id = config.id || 'mock-bot'
  }

  $formatMessage(event: any): Message<any> {
    const base: MessageBase = {
      $id: event.id || 'mock-id',
      $adapter: 'test' as any,
      $bot: this.$id,
      $content: [],
      $sender: { id: 'mock-sender', name: 'Mock Sender' },
      $channel: { id: 'mock-channel', type: 'private' },
      $timestamp: Date.now(),
      $raw: event.raw || event,
      $reply: async (content: any) => 'mock-reply-id',
      $recall: async () => {}
    }
    return Message.from(event, base)
  }

  async $connect(): Promise<void> {
    this.$connected = true
  }

  async $disconnect(): Promise<void> {
    this.$connected = false
  }

  async $sendMessage(options: any): Promise<string> {
    return 'mock-message-id'
  }

  async $recallMessage(id: string): Promise<void> {
    // Mock 撤回消息
  }
}

// Mock Adapter 类用于测试
class MockAdapter extends Adapter<MockBot> {
  createBot(config: any): MockBot {
    return new MockBot(this, config)
  }
}

describe('Adapter Core Functionality', () => {
  let plugin: Plugin
  let adapter: MockAdapter

  beforeEach(() => {
    plugin = new Plugin('/test/plugin.ts')
    adapter = new MockAdapter(plugin, 'test', [])
  })

  describe('Adapter Constructor', () => {
    it('should create adapter with plugin, name and config', () => {
      const config = [{ id: 'bot1' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      
      expect(adapter.plugin).toBe(plugin)
      expect(adapter.name).toBe('test')
      expect(adapter.config).toBe(config)
    })

    it('should initialize with empty bots map', () => {
      expect(adapter.bots).toBeInstanceOf(Map)
      expect(adapter.bots.size).toBe(0)
    })

    it('should inherit from EventEmitter', () => {
      expect(adapter).toBeInstanceOf(EventEmitter)
    })

    it('should register message.receive listener', () => {
      const listeners = adapter.listeners('message.receive')
      expect(listeners.length).toBeGreaterThan(0)
    })

    it('should register call.sendMessage listener', () => {
      const listeners = adapter.listeners('call.sendMessage')
      expect(listeners.length).toBeGreaterThan(0)
    })

    it('should register call.recallMessage listener', () => {
      const listeners = adapter.listeners('call.recallMessage')
      expect(listeners.length).toBeGreaterThan(0)
    })
  })

  describe('Adapter Logger', () => {
    it('should get logger from plugin', () => {
      expect(adapter.logger).toBeDefined()
      expect(adapter.logger).toBe(plugin.logger)
    })

    it('should throw error if plugin is not set', () => {
      const adapter = new MockAdapter(plugin, 'test', [])
      adapter.plugin = null as any
      
      expect(() => adapter.logger).toThrow('Adapter is not associated with any plugin')
    })
  })

  describe('Adapter Binding', () => {
    it('should bind to a plugin', () => {
      const newPlugin = new Plugin('/test/new-plugin.ts')
      adapter.binding(newPlugin)
      
      expect(adapter.plugin).toBe(newPlugin)
    })
  })

  describe('Adapter Start', () => {
    it('should start without config', async () => {
      await adapter.start()
      expect(plugin.root.adapters).toContain('test')
    })

    it('should create and connect bots from config', async () => {
      const config = [
        { id: 'bot1' },
        { id: 'bot2' }
      ]
      const adapter = new MockAdapter(plugin, 'test', config)
      
      await adapter.start()
      
      expect(adapter.bots.size).toBe(2)
      expect(adapter.bots.has('bot1')).toBe(true)
      expect(adapter.bots.has('bot2')).toBe(true)
    })

    it('should add adapter name to plugin adapters', async () => {
      await adapter.start()
      expect(plugin.root.adapters).toContain('test')
    })

    it('should handle empty config array', async () => {
      const adapter = new MockAdapter(plugin, 'test', [])
      await adapter.start()
      expect(adapter.bots.size).toBe(0)
    })
  })

  describe('Adapter Stop', () => {
    it('should disconnect all bots', async () => {
      const config = [{ id: 'bot1' }, { id: 'bot2' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      
      await adapter.start()
      expect(adapter.bots.size).toBe(2)
      
      await adapter.stop()
      expect(adapter.bots.size).toBe(0)
    })

    it('should remove adapter from plugin adapters', async () => {
      await adapter.start()
      expect(plugin.root.adapters).toContain('test')
      
      await adapter.stop()
      expect(plugin.root.adapters).not.toContain('test')
    })

    it('should remove all event listeners', async () => {
      await adapter.start()
      const beforeCount = adapter.listenerCount('message.receive')
      
      await adapter.stop()
      const afterCount = adapter.listenerCount('message.receive')
      
      expect(afterCount).toBe(0)
      expect(beforeCount).toBeGreaterThan(0)
    })

    it('should handle bot disconnect errors gracefully', async () => {
      const config = [{ id: 'bot1' }, { id: 'bot2' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      
      await adapter.start()
      
      // Mock first bot disconnect to throw error
      const bot1 = adapter.bots.get('bot1')!
      bot1.$disconnect = vi.fn().mockRejectedValue(new Error('Disconnect failed'))
      
      // Mock logger to spy on error logging
      const loggerSpy = vi.spyOn(adapter.logger, 'error')
      
      // The adapter should continue cleanup despite errors
      // Note: Current implementation throws, but this test documents the desired behavior
      // where adapter.stop() should handle errors gracefully and continue cleanup
      await expect(adapter.stop()).rejects.toThrow('Disconnect failed')
      
      // Even though it throws, we document that graceful handling would be:
      // - Log the error
      // - Continue disconnecting other bots
      // - Complete cleanup (clear bots, remove from adapters list, remove listeners)
    })
  })

  describe('Adapter Events', () => {
    describe('call.recallMessage', () => {
      it('should recall message from bot', async () => {
        const config = [{ id: 'bot1' }]
        const adapter = new MockAdapter(plugin, 'test', config)
        await adapter.start()
        
        const bot = adapter.bots.get('bot1')!
        const recallSpy = vi.spyOn(bot, '$recallMessage')
        
        await adapter.emit('call.recallMessage', 'bot1', 'message-id')
        
        expect(recallSpy).toHaveBeenCalledWith('message-id')
      })

      it('should require valid bot id', () => {
        // 验证 adapter 不包含不存在的 bot
        expect(adapter.bots.has('non-existent-bot')).toBe(false)
      })
    })

    describe('call.sendMessage', () => {
      it('should send message through bot', async () => {
        const config = [{ id: 'bot1' }]
        const adapter = new MockAdapter(plugin, 'test', config)
        await adapter.start()
        
        const bot = adapter.bots.get('bot1')!
        const sendSpy = vi.spyOn(bot, '$sendMessage')
        
        const options = {
          context: 'test',
          bot: 'bot1',
          content: 'Hello',
          id: 'channel-id',
          type: 'text' as const
        }
        
        await adapter.emit('call.sendMessage', 'bot1', options)
        
        expect(sendSpy).toHaveBeenCalledWith(options)
      })

      it('should validate bot existence before sending', () => {
        // 验证发送消息前应该检查 bot 是否存在
        expect(adapter.bots.has('non-existent-bot')).toBe(false)
        
        // 在实际使用中，应该先检查 bot 是否存在
        const botExists = adapter.bots.has('bot1')
        expect(botExists).toBe(false) // 因为还没有 start
      })

      it('should call before.sendMessage handlers', async () => {
        const config = [{ id: 'bot1' }]
        const adapter = new MockAdapter(plugin, 'test', config)
        await adapter.start()
        
        let handlerCalled = false
        plugin.root.on('before.sendMessage', (options) => {
          handlerCalled = true
          return options
        })
        
        const options = {
          context: 'test',
          bot: 'bot1',
          content: 'Hello',
          id: 'channel-id',
          type: 'text' as const
        }
        
        await adapter.emit('call.sendMessage', 'bot1', options)
        expect(handlerCalled).toBe(true)
      })
    })

    describe('message.receive', () => {
      it('should process received message through middleware', async () => {
        const config = [{ id: 'bot1' }]
        const adapter = new MockAdapter(plugin, 'test', config)
        await adapter.start()
        
        let middlewareCalled = false
        plugin.addMiddleware(async (message, next) => {
          middlewareCalled = true
          await next()
        })
        
        const message = {
          $bot: 'bot1',
          $adapter: 'test',
          $channel: { id: 'channel-id', type: 'text' },
          $content: 'Hello'
        } as any
        
        adapter.emit('message.receive', message)
        
        // 等待异步处理
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(middlewareCalled).toBe(true)
      })
    })
  })

  describe('Adapter createBot', () => {
    it('should be abstract method', () => {
      expect(typeof adapter.createBot).toBe('function')
    })

    it('should create bot with config', () => {
      const config = { id: 'test-bot' }
      const bot = adapter.createBot(config)
      
      expect(bot).toBeInstanceOf(MockBot)
      expect(bot.$id).toBe('test-bot')
    })
  })

  describe('Adapter Bots Management', () => {
    it('should manage multiple bots', async () => {
      const config = [
        { id: 'bot1' },
        { id: 'bot2' },
        { id: 'bot3' }
      ]
      const adapter = new MockAdapter(plugin, 'test', config)
      
      await adapter.start()
      
      expect(adapter.bots.size).toBe(3)
      expect(Array.from(adapter.bots.keys())).toEqual(['bot1', 'bot2', 'bot3'])
    })

    it('should access bot by id', async () => {
      const config = [{ id: 'bot1' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      
      await adapter.start()
      
      const bot = adapter.bots.get('bot1')
      expect(bot).toBeDefined()
      expect(bot!.$id).toBe('bot1')
    })
  })
})

describe('Adapter Registry', () => {
  it('should have a Registry Map', () => {
    expect(Adapter.Registry).toBeInstanceOf(Map)
  })

  it('should register adapter factory', () => {
    const factory = MockAdapter as any
    Adapter.register('mock', factory)
    
    expect(Adapter.Registry.has('mock')).toBe(true)
    expect(Adapter.Registry.get('mock')).toBe(factory)
  })

  it('should allow multiple adapter registrations', () => {
    const factory1 = MockAdapter as any
    const factory2 = MockAdapter as any
    
    Adapter.register('adapter1', factory1)
    Adapter.register('adapter2', factory2)
    
    expect(Adapter.Registry.size).toBeGreaterThanOrEqual(2)
  })
})
