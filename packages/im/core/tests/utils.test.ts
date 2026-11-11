/**
 * Core 特有的工具函数测试（通用工具测试已迁移到 @zhin.js/kernel）
 */
import { describe, it, expect } from 'vitest'
import { segment } from '../src/utils'

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
})
