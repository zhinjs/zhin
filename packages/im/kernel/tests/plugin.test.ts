/**
 * PluginBase tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as path from 'path'
import { PluginBase } from '../src/plugin.js'
import { Feature } from '../src/feature.js'

describe('PluginBase', () => {
  describe('Constructor', () => {
    it('derives default name from file path when no path provided', () => {
      const plugin = new PluginBase('')
      expect(plugin.name).toBe('')
    })

    it('derives default name from file path when path provided', () => {
      const plugin = new PluginBase(path.join(process.cwd(), 'foo', 'bar', 'my-plugin.ts'))
      expect(plugin.name).toBe('my-plugin')
    })

    it('strips index extension from name', () => {
      const plugin = new PluginBase(path.join(process.cwd(), 'foo', 'index.ts'))
      expect(plugin.name).toBe('foo')
    })

    it('strips query timestamp from filePath', () => {
      const plugin = new PluginBase('/foo/bar?t=123456')
      expect(plugin.filePath).toBe('/foo/bar')
    })

    it('setName overrides derived name', () => {
      const plugin = new PluginBase(path.join(process.cwd(), 'foo', 'bar', 'baz.ts'))
      expect(plugin.name).toBe('baz')
      plugin.setName('custom-name')
      expect(plugin.name).toBe('custom-name')
    })

    it('adds child to parent when parent is provided', () => {
      const parent = new PluginBase('')
      const child = new PluginBase('', parent)
      expect(parent.children).toContain(child)
      expect(child.parent).toBe(parent)
    })
  })

  describe('root getter', () => {
    it('returns self when no parent', () => {
      const plugin = new PluginBase('')
      expect(plugin.root).toBe(plugin)
    })

    it('returns top ancestor in tree', () => {
      const root = new PluginBase('root')
      const mid = new PluginBase('mid', root)
      const leaf = new PluginBase('leaf', mid)
      expect(root.root).toBe(root)
      expect(mid.root).toBe(root)
      expect(leaf.root).toBe(root)
    })
  })

  describe('provide/inject - BaseContext mode', () => {
    it('provide object with name/description/mounted/dispose, inject by name', async () => {
      const plugin = new PluginBase('')
      const mountedFn = vi.fn().mockResolvedValue({ data: 'mounted-value' })
      const disposeFn = vi.fn()

      plugin.provide({
        name: 'my-context',
        description: 'Test context',
        mounted: mountedFn,
        dispose: disposeFn,
      })

      await plugin.start()
      expect(mountedFn).toHaveBeenCalledWith(plugin)
      expect(plugin.inject('my-context')).toEqual({ data: 'mounted-value' })

      await plugin.stop()
      expect(disposeFn).toHaveBeenCalledWith({ data: 'mounted-value' })
    })

    it('inject returns undefined when context not found', () => {
      const plugin = new PluginBase('')
      expect(plugin.inject('nonexistent')).toBeUndefined()
    })

    it('inject from root finds context provided by child', async () => {
      const root = new PluginBase('')
      const child = new PluginBase('', root)
      child.provide({
        name: 'child-context',
        description: 'From child',
        mounted: async () => ({ value: 42 }),
      })
      await root.start()
      expect(root.inject('child-context')).toEqual({ value: 42 })
      await root.stop()
    })
  })

  describe('provide - Feature mode', () => {
    it('provide a Feature instance wraps it into BaseContext', async () => {
      class TestFeature extends Feature {
        readonly name = 'test-feature'
        readonly icon = 'test'
        readonly desc = 'Test feature'
        mounted = vi.fn().mockResolvedValue(undefined)
        toJSON() {
          return { name: this.name, icon: this.icon, desc: this.desc, count: 0, items: [] }
        }
      }

      const plugin = new PluginBase('')
      const feature = new TestFeature()
      plugin.provide(feature)

      await plugin.start()
      expect(feature.mounted).toHaveBeenCalledWith(plugin)
      expect(plugin.inject('test-feature')).toBe(feature)
      await plugin.stop()
    })

    it('Feature without mounted still works', async () => {
      class TestFeature extends Feature {
        readonly name = 'no-mount-feature'
        readonly icon = 'x'
        readonly desc = 'No mounted'
        toJSON() {
          return { name: this.name, icon: this.icon, desc: this.desc, count: 0, items: [] }
        }
      }

      const plugin = new PluginBase('')
      plugin.provide(new TestFeature())
      await plugin.start()
      expect(plugin.inject('no-mount-feature')).toBeInstanceOf(TestFeature)
      await plugin.stop()
    })
  })

  describe('start/stop lifecycle', () => {
    it('contexts mounted functions called on start', async () => {
      const plugin = new PluginBase('')
      const mounted1 = vi.fn().mockResolvedValue(undefined)
      const mounted2 = vi.fn().mockResolvedValue(undefined)

      plugin.provide({ name: 'ctx1', description: '', mounted: mounted1 })
      plugin.provide({ name: 'ctx2', description: '', mounted: mounted2 })

      await plugin.start()
      expect(mounted1).toHaveBeenCalledWith(plugin)
      expect(mounted2).toHaveBeenCalledWith(plugin)
      expect(plugin.started).toBe(true)
      await plugin.stop()
    })

    it('contexts dispose functions called on stop', async () => {
      const plugin = new PluginBase('')
      const dispose1 = vi.fn()
      const dispose2 = vi.fn()

      plugin.provide({
        name: 'ctx1',
        description: '',
        mounted: async () => () => {},
        dispose: dispose1,
      })
      plugin.provide({
        name: 'ctx2',
        description: '',
        mounted: async () => () => {},
        dispose: dispose2,
      })

      await plugin.start()
      await plugin.stop()
      expect(dispose1).toHaveBeenCalled()
      expect(dispose2).toHaveBeenCalled()
      expect(plugin.started).toBe(false)
    })

    it('start is idempotent', async () => {
      const plugin = new PluginBase('')
      const mounted = vi.fn().mockResolvedValue(undefined)
      plugin.provide({ name: 'ctx', description: '', mounted })
      await plugin.start()
      await plugin.start()
      expect(mounted).toHaveBeenCalledTimes(1)
      await plugin.stop()
    })
  })

  describe('onMounted/onDispose callbacks', () => {
    it('onMounted callback is called on start', async () => {
      const plugin = new PluginBase('')
      const onMounted = vi.fn()
      plugin.onMounted(onMounted)
      await plugin.start()
      expect(onMounted).toHaveBeenCalled()
      await plugin.stop()
    })

    it('onDispose callback is called on stop', async () => {
      const plugin = new PluginBase('')
      const onDispose = vi.fn()
      plugin.onDispose(onDispose)
      await plugin.start()
      await plugin.stop()
      expect(onDispose).toHaveBeenCalled()
    })

    it('onDispose returns unsubscribe function', async () => {
      const plugin = new PluginBase('')
      const onDispose = vi.fn()
      const unsubscribe = plugin.onDispose(onDispose)
      unsubscribe()
      await plugin.start()
      await plugin.stop()
      expect(onDispose).not.toHaveBeenCalled()
    })
  })

  describe('Children management', () => {
    it('child start cascades from parent', async () => {
      const parent = new PluginBase('')
      const child = new PluginBase('', parent)
      const parentMounted = vi.fn()
      const childMounted = vi.fn()
      parent.onMounted(parentMounted)
      child.onMounted(childMounted)

      await parent.start()
      expect(parentMounted).toHaveBeenCalled()
      expect(childMounted).toHaveBeenCalled()
      expect(child.started).toBe(true)
      await parent.stop()
    })

    it('child stop cascades from parent', async () => {
      const parent = new PluginBase('')
      const child = new PluginBase('', parent)
      const childDispose = vi.fn()
      child.onDispose(childDispose)

      await parent.start()
      await parent.stop()
      expect(childDispose).toHaveBeenCalled()
    })
  })

  describe('dispatch vs broadcast', () => {
    it('dispatch bubbles up to root then broadcasts', async () => {
      const root = new PluginBase('')
      const child = new PluginBase('', root)
      const leaf = new PluginBase('', child)

      const rootHandler = vi.fn()
      const childHandler = vi.fn()
      const leafHandler = vi.fn()
      root.on('test-event', rootHandler)
      child.on('test-event', childHandler)
      leaf.on('test-event', leafHandler)

      await leaf.dispatch('test-event', 'arg1')
      expect(rootHandler).toHaveBeenCalledWith('arg1')
      expect(childHandler).toHaveBeenCalledWith('arg1')
      expect(leafHandler).toHaveBeenCalledWith('arg1')
      await root.stop()
    })

    it('broadcast propagates down to children', async () => {
      const root = new PluginBase('')
      const child1 = new PluginBase('', root)
      const child2 = new PluginBase('', root)

      const rootHandler = vi.fn()
      const child1Handler = vi.fn()
      const child2Handler = vi.fn()
      root.on('broadcast-event', rootHandler)
      child1.on('broadcast-event', child1Handler)
      child2.on('broadcast-event', child2Handler)

      await root.broadcast('broadcast-event', 'data')
      expect(rootHandler).toHaveBeenCalledWith('data')
      expect(child1Handler).toHaveBeenCalledWith('data')
      expect(child2Handler).toHaveBeenCalledWith('data')
      await root.stop()
    })

    it('dispatch from root broadcasts directly', async () => {
      const root = new PluginBase('')
      const child = new PluginBase('', root)
      const handler = vi.fn()
      root.on('ev', handler)
      child.on('ev', handler)

      await root.dispatch('ev', 'x')
      expect(handler).toHaveBeenCalledTimes(2)
      await root.stop()
    })
  })

  describe('recordFeatureContribution', () => {
    it('does not throw when called', () => {
      const plugin = new PluginBase('')
      expect(() => plugin.recordFeatureContribution('feature-a', 'item-1')).not.toThrow()
      expect(() => plugin.recordFeatureContribution('feature-a', 'item-2')).not.toThrow()
      expect(() => plugin.recordFeatureContribution('feature-b', 'item-1')).not.toThrow()
    })

    it('survives plugin stop', async () => {
      const plugin = new PluginBase('')
      plugin.recordFeatureContribution('feature', 'item')
      await plugin.start()
      await plugin.stop()
      expect(plugin.started).toBe(false)
    })
  })
})
