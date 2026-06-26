import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Adapter } from '../src/adapter'
import { Endpoint } from '../src/endpoint.js'
import { Plugin } from '../src/plugin'
import { Message, MessageBase } from '../src/message'
import { EventEmitter } from 'events'

// Mock Endpoint 实现用于测试
class MockEndpoint implements Endpoint< any> {
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
      $endpoint: this.$id,
      $content: [],
      $sender: { id: 'mock-sender', name: 'Mock Sender' },
      $channel: { id: 'mock-channel', type: 'private' },
      $timestamp: Date.now(),
      $raw: event.raw || event,
      $reply: async (content: any, quote?: boolean | string) => {
        const elements = Array.isArray(content) ? content : [content]
        const finalContent: any[] = []
        
        if (quote) {
          finalContent.push({
            type: 'reply',
            data: { id: typeof quote === 'boolean' ? base.$id : quote }
          })
        }
        
        finalContent.push(...elements.map((el: any) => 
          typeof el === 'string' ? { type: 'text', data: { text: el } } : el
        ))
        
        return await this.adapter.sendMessage({
          ...base.$channel,
          context: 'test',
          endpoint: this.$id,
          content: finalContent,
        })
      },
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
class MockAdapter extends Adapter<MockEndpoint> {
  createEndpoint(config: any): MockEndpoint {
    return new MockEndpoint(this, config)
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
      expect(adapter.endpoints).toBeInstanceOf(Map)
      expect(adapter.endpoints.size).toBe(0)
    })

    it('should inherit from EventEmitter', () => {
      expect(adapter).toBeInstanceOf(EventEmitter)
    })

    it('should route message.receive via emit without default listener', () => {
      expect(adapter.listenerCount('message.receive')).toBe(0)
    })

    it('should register call.recallMessage listener', () => {
      const listeners = adapter.listeners('call.recallMessage')
      expect(listeners.length).toBeGreaterThan(0)
    })

    it('should have sendMessage method', () => {
      expect(typeof adapter.sendMessage).toBe('function')
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

    it('should create and connect endpoints from config', async () => {
      const config = [
        { id: 'bot1' },
        { id: 'bot2' }
      ]
      const adapter = new MockAdapter(plugin, 'test', config)
      
      await adapter.start()
      
      expect(adapter.endpoints.size).toBe(2)
      expect(adapter.endpoints.has('bot1')).toBe(true)
      expect(adapter.endpoints.has('bot2')).toBe(true)
    })

    it('should add adapter name to plugin adapters', async () => {
      await adapter.start()
      expect(plugin.root.adapters).toContain('test')
    })

    it('should handle empty config array', async () => {
      const adapter = new MockAdapter(plugin, 'test', [])
      await adapter.start()
      expect(adapter.endpoints.size).toBe(0)
    })
  })

  describe('Adapter Stop', () => {
    it('should disconnect all bots', async () => {
      const config = [{ id: 'bot1' }, { id: 'bot2' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      
      await adapter.start()
      expect(adapter.endpoints.size).toBe(2)
      
      await adapter.stop()
      expect(adapter.endpoints.size).toBe(0)
    })

    it('should remove adapter from plugin adapters', async () => {
      await adapter.start()
      expect(plugin.root.adapters).toContain('test')
      
      await adapter.stop()
      expect(plugin.root.adapters).not.toContain('test')
    })

    it('should remove all event listeners', async () => {
      await adapter.start()
      const noop = () => {}
      adapter.on('message.receive', noop)
      const beforeCount = adapter.listenerCount('message.receive')
      expect(beforeCount).toBe(1)

      await adapter.stop()
      const afterCount = adapter.listenerCount('message.receive')

      expect(afterCount).toBe(0)
    })

    it('should handle bot disconnect errors gracefully', async () => {
      const config = [{ id: 'bot1' }, { id: 'bot2' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      
      await adapter.start()
      
      // Mock first bot disconnect to throw error
      const bot1 = adapter.endpoints.get('bot1')!
      bot1.$disconnect = vi.fn().mockRejectedValue(new Error('Disconnect failed'))
      
      // Mock logger to spy on error logging
      const loggerSpy = vi.spyOn(adapter.logger, 'error')
      
      // adapter.stop() should handle errors gracefully: collect errors, continue cleanup
      await expect(adapter.stop()).rejects.toThrow('1 endpoint(s) failed to disconnect')
      
      // Should log the error for the failed bot
      expect(loggerSpy).toHaveBeenCalled()
      
      // Should still clean up all bots (including the second one that succeeded)
      expect(adapter.endpoints.size).toBe(0)
    })
  })

  describe('Adapter Events', () => {
    describe('call.recallMessage', () => {
      it('should recall message from bot', async () => {
        const config = [{ id: 'bot1' }]
        const adapter = new MockAdapter(plugin, 'test', config)
        await adapter.start()
        
        const bot = adapter.endpoints.get('bot1')!
        const recallSpy = vi.spyOn(bot, '$recallMessage')
        
        await adapter.emit('call.recallMessage', 'bot1', 'message-id')
        
        expect(recallSpy).toHaveBeenCalledWith('message-id')
      })

      it('should require valid bot id', () => {
        // 验证 adapter 不包含不存在的 bot
        expect(adapter.endpoints.has('non-existent-bot')).toBe(false)
      })
    })

    describe('sendMessage', () => {
      it('should send message through bot', async () => {
        const config = [{ id: 'bot1' }]
        const adapter = new MockAdapter(plugin, 'test', config)
        await adapter.start()
        
        const bot = adapter.endpoints.get('bot1')!
        const sendSpy = vi.spyOn(bot, '$sendMessage')
        
        const options = {
          context: 'test',
          endpoint: 'bot1',
          content: 'Hello',
          id: 'channel-id',
          type: 'text' as const
        }
        
        const messageId = await adapter.sendMessage(options)
        
        expect(sendSpy).toHaveBeenCalledWith(options)
        expect(messageId).toBe('mock-message-id')
      })

      it('should throw error if endpoint not found', async () => {
        const options = {
          context: 'test',
          endpoint: 'non-existent-bot',
          content: 'Hello',
          id: 'channel-id',
          type: 'text' as const
        }
        
        await expect(adapter.sendMessage(options)).rejects.toThrow('Endpoint non-existent-bot not found')
      })

      it('should call before.sendMessage handlers', async () => {
        const config = [{ id: 'bot1' }]
        const adapter = new MockAdapter(plugin, 'test', config)
        await adapter.start()
        
        let handlerCalled = false
        
        plugin.root.on('before.sendMessage', (options) => {
          handlerCalled = true
          // 修改消息内容
          return {
            ...options,
            content: 'Modified: ' + options.content
          }
        })
        
        const bot = adapter.endpoints.get('bot1')!
        const sendSpy = vi.spyOn(bot, '$sendMessage')
        
        const options = {
          context: 'test',
          endpoint: 'bot1',
          content: 'Hello',
          id: 'channel-id',
          type: 'text' as const
        }
        
        await adapter.sendMessage(options)
        
        expect(handlerCalled).toBe(true)
        expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
          content: 'Modified: Hello'
        }))
      })

      it('should dispatch message.send after successful $sendMessage', async () => {
        const config = [{ id: 'bot1' }]
        const adapter = new MockAdapter(plugin, 'test', config)
        await adapter.start()

        const payloads: Array<{ messageId: string; adapter: string }> = []
        plugin.root.on('message.send', (payload) => {
          payloads.push({ messageId: payload.messageId, adapter: payload.adapter })
        })

        const bot = adapter.endpoints.get('bot1')!
        vi.spyOn(bot, '$sendMessage').mockResolvedValue('mid-42')

        await adapter.sendMessage({
          context: 'test',
          endpoint: 'bot1',
          content: 'Hello',
          id: 'channel-id',
          type: 'text' as const,
        })

        expect(payloads).toEqual([{ messageId: 'mid-42', adapter: 'test' }])
      })

      it('should handle multiple before.sendMessage handlers', async () => {
        const config = [{ id: 'bot1' }]
        const adapter = new MockAdapter(plugin, 'test', config)
        await adapter.start()
        
        const handlers: string[] = []
        
        plugin.root.on('before.sendMessage', (options) => {
          handlers.push('handler1')
          return options
        })
        
        plugin.root.on('before.sendMessage', (options) => {
          handlers.push('handler2')
          return options
        })
        
        const options = {
          context: 'test',
          endpoint: 'bot1',
          content: 'Hello',
          id: 'channel-id',
          type: 'text' as const
        }
        
        await adapter.sendMessage(options)
        
        expect(handlers).toEqual(['handler1', 'handler2'])
      })

      it('should log message sending', async () => {
        const config = [{ id: 'bot1' }]
        const adapter = new MockAdapter(plugin, 'test', config)
        await adapter.start()
        
        const logSpy = vi.spyOn(adapter.logger, 'info')
        
        const options = {
          context: 'test',
          endpoint: 'bot1',
          content: [{ type: 'text', data: { text: 'Hello' } }],
          id: 'channel-id',
          type: 'private' as const
        }
        
        await adapter.sendMessage(options)
        
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('send: private(channel-id)'))
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('endpoint: bot1'))
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('preview: Hello'))
      })
    })

    describe('message.receive', () => {
      const makeInboundMessage = () => ({
        $endpoint: 'bot1',
        $adapter: 'test',
        $channel: { id: 'channel-id', type: 'text' },
        $content: 'Hello',
      } as any)

      it('should still dispatch plugin message.receive when dispatcher is missing (no middleware fallback)', async () => {
        const config = [{ id: 'bot1' }]
        const adapter = new MockAdapter(plugin, 'test', config)
        await adapter.start()

        let middlewareCalled = false
        plugin.addMiddleware(async (_message, next) => {
          middlewareCalled = true
          await next()
        })

        let lifecycleCalled = false
        plugin.on('message.receive', () => {
          lifecycleCalled = true
        })

        const message = makeInboundMessage()

        adapter.emit('message.receive', message)
        await new Promise((r) => setTimeout(r, 20))
        expect(middlewareCalled).toBe(false)
        expect(lifecycleCalled).toBe(true)
      })

      it('should await MessageDispatcher then plugin lifecycle', async () => {
        const config = [{ id: 'bot1' }]
        const adapter = new MockAdapter(plugin, 'test', config)
        await adapter.start()

        const order: string[] = []
        plugin.$contexts.set('dispatcher', {
          name: 'dispatcher',
          description: 'mock dispatcher',
          value: {
            dispatch: async (_msg: any) => {
              order.push('dispatcher')
            },
          },
        } as any)

        plugin.on('message.receive', () => {
          order.push('lifecycle')
        })

        const message = makeInboundMessage()

        adapter.emit('message.receive', message)
        await new Promise((r) => setTimeout(r, 20))
        expect(order).toEqual(['dispatcher', 'lifecycle'])
      })

      it('should call adapter.on observers after plugin lifecycle', async () => {
        const config = [{ id: 'bot1' }]
        const adapter = new MockAdapter(plugin, 'test', config)
        await adapter.start()

        plugin.$contexts.set('dispatcher', {
          name: 'dispatcher',
          description: 'mock dispatcher',
          value: { dispatch: async () => {} },
        } as any)

        const order: string[] = []
        plugin.on('message.receive', () => order.push('lifecycle'))
        adapter.on('message.receive', () => order.push('adapterObserver'))

        const message = makeInboundMessage()

        adapter.emit('message.receive', message)
        await new Promise((r) => setTimeout(r, 20))
        expect(order).toEqual(['lifecycle', 'adapterObserver'])
      })

      it('should drop message.receive when concurrency limit is reached', async () => {
        plugin.$contexts.set('config', {
          name: 'config',
          description: 'mock config',
          value: {
            getPrimary: () => ({ max_concurrent_messages: 1 }),
          },
        } as any)
        plugin.$contexts.set('dispatcher', {
          name: 'dispatcher',
          description: 'mock dispatcher',
          value: {
            dispatch: async () => new Promise(resolve => setTimeout(resolve, 30)),
          },
        } as any)
        const warnSpy = vi.spyOn(adapter.logger, 'warn')

        expect(adapter.emit('message.receive', makeInboundMessage())).toBe(true)
        expect(adapter.pendingMessages).toBe(1)
        expect(adapter.emit('message.receive', makeInboundMessage())).toBe(false)
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('drop: concurrency'))

        await vi.waitFor(() => expect(adapter.pendingMessages).toBe(0))
      })

      it('should restore pending count when inbound handling throws', async () => {
        plugin.$contexts.set('dispatcher', {
          name: 'dispatcher',
          description: 'mock dispatcher',
          value: {
            dispatch: async () => { throw new Error('boom') },
          },
        } as any)
        const warnSpy = vi.spyOn(adapter.logger, 'warn')

        expect(adapter.emit('message.receive', makeInboundMessage())).toBe(true)
        expect(adapter.pendingMessages).toBe(1)

        await vi.waitFor(() => expect(adapter.pendingMessages).toBe(0))
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('error: boom'))
      })
    })
  })

  describe('Adapter createEndpoint', () => {
    it('should be abstract method', () => {
      expect(typeof adapter.createEndpoint).toBe('function')
    })

    it('should create bot with config', () => {
      const config = { id: 'test-bot' }
      const bot = adapter.createEndpoint(config)
      
      expect(bot).toBeInstanceOf(MockEndpoint)
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
      
      expect(adapter.endpoints.size).toBe(3)
      expect(Array.from(adapter.endpoints.keys())).toEqual(['bot1', 'bot2', 'bot3'])
    })

    it('should access bot by id', async () => {
      const config = [{ id: 'bot1' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      
      await adapter.start()
      
      const bot = adapter.endpoints.get('bot1')
      expect(bot).toBeDefined()
      expect(bot!.$id).toBe('bot1')
    })
  })

  describe('Message $reply', () => {
    it('should send reply through adapter.sendMessage', async () => {
      const config = [{ id: 'bot1' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      await adapter.start()
      
      const bot = adapter.endpoints.get('bot1')!
      const message = bot.$formatMessage({ id: 'msg-1', raw: 'Hello' })
      
      const sendSpy = vi.spyOn(adapter, 'sendMessage')
      
      await message.$reply('Reply content')
      
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
        endpoint: 'bot1',
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'text', data: { text: 'Reply content' } })
        ])
      }))
    })

    it('should support quote reply', async () => {
      const config = [{ id: 'bot1' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      await adapter.start()
      
      const bot = adapter.endpoints.get('bot1')!
      const message = bot.$formatMessage({ id: 'msg-1', raw: 'Hello' })
      
      const sendSpy = vi.spyOn(adapter, 'sendMessage')
      
      await message.$reply('Reply content', true)
      
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'reply', data: { id: 'msg-1' } }),
          expect.objectContaining({ type: 'text', data: { text: 'Reply content' } })
        ])
      }))
    })

    it('should support custom quote id', async () => {
      const config = [{ id: 'bot1' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      await adapter.start()
      
      const bot = adapter.endpoints.get('bot1')!
      const message = bot.$formatMessage({ id: 'msg-1', raw: 'Hello' })
      
      const sendSpy = vi.spyOn(adapter, 'sendMessage')
      
      await message.$reply('Reply content', 'custom-msg-id')
      
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'reply', data: { id: 'custom-msg-id' } })
        ])
      }))
    })

    it('should handle array content', async () => {
      const config = [{ id: 'bot1' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      await adapter.start()
      
      const bot = adapter.endpoints.get('bot1')!
      const message = bot.$formatMessage({ id: 'msg-1', raw: 'Hello' })
      
      const sendSpy = vi.spyOn(adapter, 'sendMessage')
      
      await message.$reply([
        { type: 'text', data: { text: 'Part 1' } },
        { type: 'text', data: { text: 'Part 2' } }
      ])
      
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'text', data: { text: 'Part 1' } }),
          expect.objectContaining({ type: 'text', data: { text: 'Part 2' } })
        ])
      }))
    })

    it('should trigger before.sendMessage hooks', async () => {
      const config = [{ id: 'bot1' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      await adapter.start()
      
      let hookCalled = false
      plugin.root.on('before.sendMessage', (options) => {
        hookCalled = true
        return options
      })
      
      const bot = adapter.endpoints.get('bot1')!
      const message = bot.$formatMessage({ id: 'msg-1', raw: 'Hello' })
      
      await message.$reply('Reply content')
      
      expect(hookCalled).toBe(true)
    })
  })

  describe('editMessage', () => {
    it('should call $editMessage when endpoint implements it', async () => {
      const config = [{ id: 'bot1' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      await adapter.start()

      const bot = adapter.endpoints.get('bot1')!
      const editSpy = vi.fn()
      ;(bot as any).$editMessage = editSpy

      await adapter.editMessage({
        messageId: 'msg-123',
        context: 'test',
        endpoint: 'bot1',
        id: 'chan-1',
        type: 'group',
        content: 'Updated content',
      })

      expect(editSpy).toHaveBeenCalled()
    })

    it('should fallback to sendMessage when endpoint does not support $editMessage', async () => {
      const config = [{ id: 'bot1' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      await adapter.start()

      const sendSpy = vi.spyOn(adapter, 'sendMessage')

      const result = await adapter.editMessage({
        messageId: 'msg-123',
        context: 'test',
        endpoint: 'bot1',
        id: 'chan-1',
        type: 'group',
        content: 'Updated content',
      })

      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
        context: 'test',
        endpoint: 'bot1',
        id: 'chan-1',
        type: 'group',
      }))
      expect(result).toBe('mock-message-id')
    })

    it('should return original messageId when edit succeeds', async () => {
      const config = [{ id: 'bot1' }]
      const adapter = new MockAdapter(plugin, 'test', config)
      await adapter.start()

      const bot = adapter.endpoints.get('bot1')!
      ;(bot as any).$editMessage = vi.fn()

      const result = await adapter.editMessage({
        messageId: 'original-msg-id',
        context: 'test',
        endpoint: 'bot1',
        id: 'chan-1',
        type: 'group',
        content: 'Updated content',
      })

      expect(result).toBe('original-msg-id')
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
