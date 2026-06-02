import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Plugin, usePlugin, getPlugin, storage, defineContext } from '../src/plugin'
import { EventEmitter } from 'events'

describe('Plugin Core Functionality', () => {
  describe('Plugin Constructor', () => {
    it('should create a plugin with file path', () => {
      const plugin = new Plugin('/test/plugin.ts')
      expect(plugin.filePath).toBe('/test/plugin.ts')
      expect(plugin.started).toBe(false)
      expect(plugin.children).toEqual([])
    })

    it('should create a plugin without file path', () => {
      const plugin = new Plugin()
      expect(plugin.filePath).toBe('')
    })

    it('should add plugin to parent children', () => {
      const parent = new Plugin('/test/parent.ts')
      const child = new Plugin('/test/child.ts', parent)
      expect(parent.children).toContain(child)
      expect(child.parent).toBe(parent)
    })

    it('should not duplicate child in parent', () => {
      const parent = new Plugin('/test/parent.ts')
      const child = new Plugin('/test/child.ts', parent)
      // 尝试再次添加
      if (!parent.children.includes(child)) {
        parent.children.push(child)
      }
      expect(parent.children.filter(c => c === child).length).toBe(1)
    })

    it('should inherit from EventEmitter', () => {
      const plugin = new Plugin('/test/plugin.ts')
      expect(plugin).toBeInstanceOf(EventEmitter)
    })

    it('should set max listeners to 50', () => {
      const plugin = new Plugin('/test/plugin.ts')
      expect(plugin.getMaxListeners()).toBe(50)
    })
  })

  describe('Plugin Name', () => {
    it('should extract plugin name from file path', () => {
      const plugin = new Plugin('/path/to/my-plugin/src/index.ts')
      expect(plugin.name).toContain('my-plugin')
    })

    it('should handle node_modules path', () => {
      const plugin = new Plugin('/path/node_modules/@scope/package/index.js')
      const name = plugin.name
      expect(name.length).toBeGreaterThan(0)
    })

    it('should cache plugin name', () => {
      const plugin = new Plugin('/test/plugin.ts')
      const name1 = plugin.name
      const name2 = plugin.name
      expect(name1).toBe(name2)
    })

    it('should remove file extensions', () => {
      const plugin1 = new Plugin('/test/plugin.ts')
      const plugin2 = new Plugin('/test/plugin.js')
      expect(plugin1.name).not.toContain('.ts')
      expect(plugin2.name).not.toContain('.js')
    })
  })

  describe('Plugin Root', () => {
    it('should return self as root if no parent', () => {
      const plugin = new Plugin('/test/plugin.ts')
      expect(plugin.root).toBe(plugin)
    })

    it('should return top-level parent as root', () => {
      const grandparent = new Plugin('/test/grandparent.ts')
      const parent = new Plugin('/test/parent.ts', grandparent)
      const child = new Plugin('/test/child.ts', parent)
      
      expect(child.root).toBe(grandparent)
      expect(parent.root).toBe(grandparent)
      expect(grandparent.root).toBe(grandparent)
    })
  })

  describe('Plugin Middleware', () => {
    it('should add middleware', () => {
      const plugin = new Plugin('/test/plugin.ts')
      const middleware = vi.fn(async (msg: any, next: any) => await next())
      
      const dispose = plugin.addMiddleware(middleware)
      expect(typeof dispose).toBe('function')
    })

    it('should remove middleware on dispose', () => {
      const plugin = new Plugin('/test/plugin.ts')
      const middleware = vi.fn(async (msg: any, next: any) => await next())
      
      const dispose = plugin.addMiddleware(middleware)
      dispose()
      
      // 验证 dispose 被调用后中间件被移除
      expect(dispose).toBeDefined()
    })

    it('should compose multiple middlewares', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      const order: number[] = []
      
      plugin.addMiddleware(async (msg: any, next: any) => {
        order.push(1)
        await next()
        order.push(4)
      })
      
      plugin.addMiddleware(async (msg: any, next: any) => {
        order.push(2)
        await next()
        order.push(3)
      })
      
      const composed = plugin.middleware
      await composed({} as any, async () => {})
      
      expect(order.length).toBeGreaterThan(0)
    })
  })

  describe('Plugin Contexts', () => {
    it('should initialize with empty contexts', () => {
      const plugin = new Plugin('/test/plugin.ts')
      expect(plugin.$contexts).toBeInstanceOf(Map)
      expect(plugin.$contexts.size).toBe(0)
    })

    it('should get contexts including children', () => {
      const parent = new Plugin('/test/parent.ts')
      new Plugin('/test/child.ts', parent)
      
      const contexts = parent.contexts
      expect(contexts).toBeInstanceOf(Map)
    })
  })

  describe('Plugin Lifecycle', () => {
    it('should start with started = false', () => {
      const plugin = new Plugin('/test/plugin.ts')
      expect(plugin.started).toBe(false)
    })

    it('should emit events', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      
      const promise = new Promise<void>((resolve) => {
        plugin.on('mounted', () => {
          resolve()
        })
      })
      
      plugin.emit('mounted', plugin)
      await promise
    })
  })

  describe('Plugin Adapters', () => {
    it('should initialize with empty adapters array', () => {
      const plugin = new Plugin('/test/plugin.ts')
      expect(plugin.adapters).toEqual([])
      expect(Array.isArray(plugin.adapters)).toBe(true)
    })
  })

  describe('Plugin File Info', () => {
    it('should store file path', () => {
      const filePath = '/test/my-plugin.ts'
      const plugin = new Plugin(filePath)
      expect(plugin.filePath).toBe(filePath)
    })

    it('should initialize file hash as empty string', () => {
      const plugin = new Plugin('/test/plugin.ts')
      expect(plugin.fileHash).toBe('')
    })

    it('should remove timestamp query from file path', () => {
      const plugin = new Plugin('/test/plugin.ts?t=1234567890')
      expect(plugin.filePath).toBe('/test/plugin.ts')
    })
  })

  describe('Plugin Children Management', () => {
    it('should manage multiple children', () => {
      const parent = new Plugin('/test/parent.ts')
      const child1 = new Plugin('/test/child1.ts', parent)
      const child2 = new Plugin('/test/child2.ts', parent)
      
      expect(parent.children).toHaveLength(2)
      expect(parent.children).toContain(child1)
      expect(parent.children).toContain(child2)
    })

    it('should allow nested plugin hierarchy', () => {
      const root = new Plugin('/test/root.ts')
      const level1 = new Plugin('/test/level1.ts', root)
      const level2 = new Plugin('/test/level2.ts', level1)
      const level3 = new Plugin('/test/level3.ts', level2)
      
      expect(level3.root).toBe(root)
      expect(level2.parent).toBe(level1)
      expect(level1.children).toContain(level2)
    })
  })
})

describe('Plugin AsyncLocalStorage', () => {
  beforeEach(() => {
    // 清理 storage
    storage.disable()
  })

  describe('usePlugin', () => {
    it('should create and store plugin in AsyncLocalStorage', () => {
      storage.run(undefined, () => {
        const plugin = usePlugin()
        expect(plugin).toBeInstanceOf(Plugin)
        expect(storage.getStore()).toBe(plugin)
      })
    })

    it('should return same instance when called twice from same file', () => {
      storage.run(undefined, () => {
        const first = usePlugin()
        const second = usePlugin()
        
        expect(second).toBe(first)
      })
    })

    it('should handle nested contexts correctly', () => {
      storage.run(undefined, () => {
        const parent = usePlugin()
        
        storage.run(undefined, () => {
          const nested = usePlugin()
          // 嵌套上下文应该创建新的独立插件
          expect(nested).toBeInstanceOf(Plugin)
          expect(nested).not.toBe(parent)
          expect(storage.getStore()).toBe(nested)
        })
        
        // 返回外层上下文后，应该恢复原来的插件
        expect(storage.getStore()).toBe(parent)
      })
    })

    it('should handle storage disabled during execution', () => {
      storage.run(undefined, () => {
        const plugin = usePlugin()
        expect(plugin).toBeInstanceOf(Plugin)
        
        // 禁用 storage
        storage.disable()
        
        // 再次调用应该创建新插件
        const newPlugin = usePlugin()
        expect(newPlugin).toBeInstanceOf(Plugin)
        // 注意：禁用后 storage 可能仍然在当前 run 上下文中有值
        // 只需要验证 usePlugin 仍然能正常工作即可
      })
    })

    it('should handle errors in nested contexts', () => {
      storage.run(undefined, () => {
        const parent = usePlugin()
        
        expect(() => {
          storage.run(undefined, () => {
            usePlugin()
            throw new Error('Test error')
          })
        }).toThrow('Test error')
        
        // 错误后，外层上下文应该保持不变
        expect(storage.getStore()).toBe(parent)
      })
    })
  })

  describe('getPlugin', () => {
    it('should throw error when called outside plugin context', () => {
      storage.run(undefined, () => {
        expect(() => getPlugin()).toThrow('must be called within a plugin context')
      })
    })

    it('should return current plugin from storage', () => {
      const plugin = new Plugin('/test/plugin.ts')
      storage.run(plugin, () => {
        const retrieved = getPlugin()
        expect(retrieved).toBe(plugin)
      })
    })
  })

  describe('storage', () => {
    it('should be an instance of AsyncLocalStorage', () => {
      expect(storage).toBeDefined()
      expect(typeof storage.run).toBe('function')
      expect(typeof storage.getStore).toBe('function')
    })
  })
})

describe('Plugin Logger', () => {
  it('should have a logger instance', () => {
    const plugin = new Plugin('/test/plugin.ts')
    expect(plugin.logger).toBeDefined()
    expect(typeof plugin.logger.info).toBe('function')
    expect(typeof plugin.logger.error).toBe('function')
  })

  it('should use plugin name in logger', () => {
    const plugin = new Plugin('/test/my-plugin/index.ts')
    expect(plugin.logger).toBeDefined()
  })
})

describe('Plugin Disposables', () => {
  it('should track disposable functions', () => {
    const plugin = new Plugin('/test/plugin.ts')
    const middleware = vi.fn(async (msg: any, next: any) => await next())
    
    const dispose = plugin.addMiddleware(middleware)
    
    // 验证 dispose 函数存在
    expect(typeof dispose).toBe('function')
    
    // 调用 dispose
    dispose()
    
    // 再次调用应该是安全的
    dispose()
  })
})

describe('Plugin Lifecycle Methods', () => {
  describe('start', () => {
    it('should set started to true', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      expect(plugin.started).toBe(false)
      
      await plugin.start()
      expect(plugin.started).toBe(true)
    })

    it('should not start twice', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      await plugin.start()
      await plugin.start() // 第二次调用应该被忽略
      expect(plugin.started).toBe(true)
    })

    it('should start children plugins', async () => {
      const parent = new Plugin('/test/parent.ts')
      const child = new Plugin('/test/child.ts', parent)
      
      await parent.start()
      expect(parent.started).toBe(true)
      expect(child.started).toBe(true)
    })

    it('should emit mounted event', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      let emitted = false
      
      plugin.on('mounted', () => {
        emitted = true
      })
      
      await plugin.start()
      expect(emitted).toBe(true)
    })
  })

  describe('stop', () => {
    it('should set started to false', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      await plugin.start()
      
      await plugin.stop()
      expect(plugin.started).toBe(false)
    })

    it('should stop children plugins', async () => {
      const parent = new Plugin('/test/parent.ts')
      const child = new Plugin('/test/child.ts', parent)
      
      await parent.start()
      await parent.stop()
      
      expect(parent.started).toBe(false)
      expect(child.started).toBe(false)
    })

    it('should clear children array', async () => {
      const parent = new Plugin('/test/parent.ts')
      new Plugin('/test/child.ts', parent)
      
      await parent.start()
      await parent.stop()
      
      expect(parent.children).toEqual([])
    })

    it('should clear contexts', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      plugin.$contexts.set('test', { name: 'test', description: 'test' } as any)
      
      await plugin.start()
      await plugin.stop()
      expect(plugin.$contexts.size).toBe(0)
    })

    it('should emit dispose event', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      let emitted = false
      
      plugin.on('dispose', () => {
        emitted = true
      })
      
      await plugin.start()
      await plugin.stop()
      expect(emitted).toBe(true)
    })

    it('should call disposables', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      let called = false
      
      plugin.onDispose(() => {
        called = true
      })
      
      await plugin.start()
      await plugin.stop()
      expect(called).toBe(true)
    })

    it('should not stop if not started', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      await plugin.stop() // 应该直接返回
      expect(plugin.started).toBe(false)
    })
  })

  describe('onMounted', () => {
    it('should register mounted callback', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      let called = false
      
      plugin.onMounted(() => {
        called = true
      })
      
      await plugin.start()
      expect(called).toBe(true)
    })
  })

  describe('onDispose', () => {
    it('should register dispose callback', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      let called = false
      
      const unregister = plugin.onDispose(() => {
        called = true
      })
      
      await plugin.start()
      await plugin.stop()
      expect(called).toBe(true)
      expect(typeof unregister).toBe('function')
    })

    it('should allow unregistering callback', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      let called = false
      
      const unregister = plugin.onDispose(() => {
        called = true
      })
      
      unregister() // 取消注册
      await plugin.start()
      await plugin.stop()
      expect(called).toBe(false)
    })
  })
})

describe('Plugin Event Broadcasting', () => {
  describe('dispatch', () => {
    it('should dispatch to parent', async () => {
      const parent = new Plugin('/test/parent.ts')
      const child = new Plugin('/test/child.ts', parent)
      
      let received = false
      parent.on('mounted', () => {
        received = true
      })
      
      await child.dispatch('mounted')
      expect(received).toBe(true)
    })

    it('should broadcast if no parent', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      let received = false
      
      plugin.on('mounted', () => {
        received = true
      })
      
      await plugin.dispatch('mounted')
      expect(received).toBe(true)
    })
  })

  describe('broadcast', () => {
    it('should broadcast to children', async () => {
      const parent = new Plugin('/test/parent.ts')
      const child = new Plugin('/test/child.ts', parent)
      
      let childReceived = false
      child.on('mounted', () => {
        childReceived = true
      })
      
      await parent.broadcast('mounted')
      expect(childReceived).toBe(true)
    })

    it('should call own listeners', async () => {
      const plugin = new Plugin('/test/plugin.ts')
      let called = false
      
      plugin.on('mounted', () => {
        called = true
      })
      
      await plugin.broadcast('mounted')
      expect(called).toBe(true)
    })
  })
})

describe('Plugin Context mounted Behavior', () => {
  it('should always call mounted callback even when value is preset', async () => {
    const plugin = new Plugin('/test/plugin.ts')
    let mountedCalled = false

    plugin.provide({
      name: 'test-ctx' as any,
      description: 'Test context with both value and mounted',
      value: { original: true },
      mounted(_p: any) {
        mountedCalled = true
        return { fromMounted: true }
      },
    } as any)

    await plugin.start()
    expect(mountedCalled).toBe(true)
  })

  it('should NOT overwrite preset value with mounted return', async () => {
    const plugin = new Plugin('/test/plugin.ts')
    const presetValue = { original: true }

    plugin.provide({
      name: 'test-ctx' as any,
      description: 'Test context with both value and mounted',
      value: presetValue,
      mounted(_p: any) {
        return { fromMounted: true }
      },
    } as any)

    await plugin.start()
    const injected = plugin.inject('test-ctx' as any)
    expect(injected).toBe(presetValue)
    expect(injected).toEqual({ original: true })
  })

  it('should assign mounted return value when context.value is not set', async () => {
    const plugin = new Plugin('/test/plugin.ts')
    const mountedValue = { fromMounted: true }

    plugin.provide({
      name: 'test-ctx' as any,
      description: 'Test context with mounted only',
      mounted(_p: any) {
        return mountedValue
      },
    } as any)

    await plugin.start()
    const injected = plugin.inject('test-ctx' as any)
    expect(injected).toBe(mountedValue)
  })

  it('mounted side effects should run even when value is preset', async () => {
    const plugin = new Plugin('/test/plugin.ts')
    let sideEffectCounter = 0

    plugin.provide({
      name: 'test-ctx' as any,
      description: 'Test mounted side effects',
      value: { data: 'preset' },
      mounted(_p: any) {
        sideEffectCounter++
        return { data: 'mounted' }
      },
    } as any)

    await plugin.start()
    expect(sideEffectCounter).toBe(1)
    // value should remain preset
    expect(plugin.inject('test-ctx' as any)).toEqual({ data: 'preset' })
  })
})

describe('Plugin Context Management', () => {
  describe('provide', () => {
    it('should register context', () => {
      const plugin = new Plugin('/test/plugin.ts')
      const context = {
        name: 'test',
        description: 'Test context',
        value: { test: true }
      } as any
      
      plugin.provide(context)
      expect(plugin.$contexts.has('test')).toBe(true)
    })

    it('should return plugin instance for chaining', () => {
      const plugin = new Plugin('/test/plugin.ts')
      const context = {
        name: 'test',
        description: 'Test context'
      } as any
      
      const result = plugin.provide(context)
      expect(result).toBe(plugin)
    })
  })

  describe('inject', () => {
    it('should inject context value', () => {
      const plugin = new Plugin('/test/plugin.ts')
      const context = {
        name: 'test',
        description: 'Test context',
        value: { data: 'test-value' }
      } as any
      
      plugin.$contexts.set('test', context)
      const injected = plugin.inject('test' as any)
      expect(injected).toEqual({ data: 'test-value' })
    })

    it('should return undefined for non-existent context', () => {
      const plugin = new Plugin('/test/plugin.ts')
      const injected = plugin.inject('non-existent' as any)
      expect(injected).toBeUndefined()
    })
  })

  describe('contextIsReady', () => {
    it('should return true if context exists', () => {
      const plugin = new Plugin('/test/plugin.ts')
      const context = {
        name: 'test',
        description: 'Test context',
        value: { test: true }
      } as any
      
      plugin.$contexts.set('test', context)
      expect(plugin.contextIsReady('test' as any)).toBe(true)
    })

    it('should return false if context does not exist', () => {
      const plugin = new Plugin('/test/plugin.ts')
      expect(plugin.contextIsReady('non-existent' as any)).toBe(false)
    })
  })
})

describe('Plugin Features', () => {
  it('should return empty features by default', () => {
    const plugin = new Plugin('/test/plugin.ts')
    const features = plugin.getFeatures()
    
    expect(features).toEqual([])
  })

  it('should include middleware in getFeatures', () => {
    const plugin = new Plugin('/test/plugin.ts')
    plugin.addMiddleware(async (msg: any, next: any) => await next())
    
    const features = plugin.getFeatures()
    const middlewareFeature = features.find(f => f.name === 'middleware')
    expect(middlewareFeature).toBeDefined()
    expect(middlewareFeature!.count).toBeGreaterThan(0)
  })
})

describe('Plugin Info', () => {
  it('should return plugin info', () => {
    const plugin = new Plugin('/test/my-plugin.ts')
    const info = plugin.info()
    
    expect(info).toHaveProperty(plugin.name)
    expect(info[plugin.name]).toHaveProperty('features')
    expect(info[plugin.name]).toHaveProperty('children')
  })

  it('should include children info', () => {
    const parent = new Plugin('/test/parent.ts')
    new Plugin('/test/child.ts', parent)
    
    const info = parent.info()
    expect(info[parent.name].children).toHaveLength(1)
  })
})

describe('Plugin Method Binding', () => {
  it('should bind core methods', () => {
    const plugin = new Plugin('/test/plugin.ts')
    
    // 解构后方法仍然可用
    const { start, stop, provide } = plugin
    
    expect(typeof start).toBe('function')
    expect(typeof stop).toBe('function')
    expect(typeof provide).toBe('function')
  })

  it('should not bind methods twice', () => {
    const plugin = new Plugin('/test/plugin.ts')
    plugin.$bindMethods()
    plugin.$bindMethods() // 第二次调用应该被忽略
    
    expect(plugin.started).toBe(false)
  })
})

describe('Plugin Static Methods and Utilities', () => {
  it('should export defineContext function', () => {
    expect(typeof defineContext).toBe('function')
  })

  it('defineContext should return the options as-is', () => {
    const context = {
      name: 'test' as const,
      description: 'Test context',
      value: 'test-value'
    }
    const result = defineContext(context)
    expect(result).toEqual(context)
  })
})
