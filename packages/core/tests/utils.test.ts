/**
 * Core 特有的工具函数测试（通用工具测试已迁移到 @zhin.js/kernel）
 */
import { describe, it, expect } from 'vitest'
import { compose, segment } from '../src/utils'

describe('compose middleware', () => {
  it('should return empty function for empty middlewares', async () => {
    const composed = compose([])
    await expect(composed({} as any, async () => {})).resolves.toBeUndefined()
  })

  it('should handle single middleware', async () => {
    let called = false
    const middleware = async (msg: any, next: any) => {
      called = true
      await next()
    }
    const composed = compose([middleware])
    await composed({} as any, async () => {})
    expect(called).toBe(true)
  })

  it('should compose multiple middlewares in order', async () => {
    const order: number[] = []
    const middleware1 = async (msg: any, next: any) => {
      order.push(1)
      await next()
      order.push(4)
    }
    const middleware2 = async (msg: any, next: any) => {
      order.push(2)
      await next()
      order.push(3)
    }
    const composed = compose([middleware1, middleware2])
    await composed({} as any, async () => {})
    expect(order).toEqual([1, 2, 3, 4])
  })

  it('should handle middleware execution order correctly', async () => {
    const order: string[] = []
    const middleware1 = async (msg: any, next: any) => {
      order.push('m1-before')
      await next()
      order.push('m1-after')
    }
    const middleware2 = async (msg: any, next: any) => {
      order.push('m2-before')
      await next()
      order.push('m2-after')
    }
    const middleware3 = async (msg: any, next: any) => {
      order.push('m3')
      await next()
    }
    const composed = compose([middleware1, middleware2, middleware3])
    await composed({} as any, async () => { order.push('final') })
    expect(order).toEqual(['m1-before', 'm2-before', 'm3', 'final', 'm2-after', 'm1-after'])
  })

  it('should catch and rethrow middleware errors', async () => {
    const middleware = async () => { throw new Error('Middleware error') }
    const composed = compose([middleware])
    await expect(composed({} as any, async () => {})).rejects.toThrow('Middleware error')
  })
})

describe('segment utilities', () => {
  describe('escape and unescape', () => {
    it('should escape HTML entities', () => {
      expect(segment.escape('<div>&"\'</div>')).toBe('&lt;div&gt;&amp;&quot;&#39;&lt;/div&gt;')
    })

    it('should unescape HTML entities', () => {
      expect(segment.unescape('&lt;div&gt;&amp;&quot;&#39;&lt;/div&gt;')).toBe('<div>&"\'</div>')
    })
  })

  describe('text and face', () => {
    it('should create text segment', () => {
      expect(segment.text('Hello')).toEqual({ type: 'text', data: { text: 'Hello' } })
    })

    it('should create face segment', () => {
      expect(segment.face('smile', '😊')).toEqual({
        type: 'face',
        data: { id: 'smile', text: '😊' }
      })
    })
  })

  describe('from', () => {
    it('should parse simple text', () => {
      const result = segment.from('Hello World')
      expect(result).toEqual([{ type: 'text', data: { text: 'Hello World' } }])
    })

    it('should parse self-closing tags', () => {
      const result = segment.from('<image url="test.jpg" />')
      expect(result.find(el => el.type === 'image')).toBeDefined()
    })

    it('should handle malformed templates gracefully', () => {
      const result = segment.from('Hello <unclosed')
      expect(result[0].type).toBe('text')
    })
  })

  describe('raw', () => {
    it('should convert segments to raw text', () => {
      const content = [
        { type: 'text', data: { text: 'Hello' } },
        { type: 'face', data: { text: '😊' } },
      ]
      expect(segment.raw(content)).toBe('Hello{face}(😊)')
    })

    it('should handle string input', () => {
      expect(segment.raw('Hello')).toBe('Hello')
    })
  })

  describe('toString', () => {
    it('should convert segments to string', () => {
      const content = [
        { type: 'text', data: { text: 'Hello' } },
        { type: 'image', data: { url: 'test.jpg' } },
      ]
      const result = segment.toString(content)
      expect(result).toContain('Hello')
      expect(result).toContain('<image')
    })
  })
})
