import { describe, it, expect } from 'vitest'
import {
  createSensitiveWordRegex,
  getEnabledWords,
  type SensitiveFilterOptions,
  politicalWords,
  violenceWords,
  pornWords,
} from '../src/sensitive-words'

describe('敏感词过滤测试', () => {
  describe('敏感词正则表达式', () => {
    it('应该创建有效的正则表达式', () => {
      const words = ['测试', '敏感词']
      const regex = createSensitiveWordRegex(words)
      
      expect(regex).toBeInstanceOf(RegExp)
      expect(regex.test('这是测试')).toBe(true)
      expect(regex.test('这是敏感词')).toBe(true)
      expect(regex.test('这是正常内容')).toBe(false)
    })

    it('应该转义特殊字符', () => {
      const words = ['$test', '.*word']
      const regex = createSensitiveWordRegex(words)
      
      expect(regex.test('$test')).toBe(true)
      expect(regex.test('.*word')).toBe(true)
    })

    it('应该不区分大小写', () => {
      const words = ['Test']
      const regex = createSensitiveWordRegex(words)
      
      expect(regex.test('test')).toBe(true)
      expect(regex.test('TEST')).toBe(true)
      expect(regex.test('TeSt')).toBe(true)
    })
  })

  describe('获取启用的敏感词', () => {
    it('应该返回所有启用的敏感词', () => {
      const options: SensitiveFilterOptions = {
        political: true,
        violence: true,
        porn: true,
      }
      
      const words = getEnabledWords(options)
      
      expect(words.length).toBeGreaterThan(0)
      expect(words).toContain(politicalWords[0])
      expect(words).toContain(violenceWords[0])
      expect(words).toContain(pornWords[0])
    })

    it('应该只返回启用类别的敏感词', () => {
      const options: SensitiveFilterOptions = {
        political: true,
        violence: false,
        porn: false,
      }
      
      const words = getEnabledWords(options)
      
      expect(words).toContain(politicalWords[0])
      expect(words).not.toContain(violenceWords[0])
      expect(words).not.toContain(pornWords[0])
    })

    it('应该包含自定义敏感词', () => {
      const options: SensitiveFilterOptions = {
        custom: ['自定义词1', '自定义词2'],
      }
      
      const words = getEnabledWords(options)
      
      expect(words).toContain('自定义词1')
      expect(words).toContain('自定义词2')
    })
  })

  describe('敏感词检测', () => {
    it('应该检测出敏感词', () => {
      const words = ['测试', '敏感']
      const regex = createSensitiveWordRegex(words)
      
      const text = '这是一个测试敏感词的文本'
      const matches = text.match(regex)
      
      expect(matches).not.toBeNull()
      expect(matches?.length).toBe(2)
      expect(matches).toContain('测试')
      expect(matches).toContain('敏感')
    })

    it('应该去重检测结果', () => {
      const words = ['测试']
      const regex = createSensitiveWordRegex(words)
      
      const text = '测试 测试 测试'
      const matches = text.match(regex)
      const unique = [...new Set(matches || [])]
      
      expect(unique.length).toBe(1)
    })
  })

  describe('敏感词替换', () => {
    it('应该替换敏感词为指定字符', () => {
      const words = ['敏感词']
      const regex = createSensitiveWordRegex(words)
      
      const text = '这是一个敏感词测试'
      const result = text.replace(regex, (match) => '*'.repeat(match.length))
      
      expect(result).toBe('这是一个***测试')
    })

    it('应该替换所有匹配的敏感词', () => {
      const words = ['测试', '敏感']
      const regex = createSensitiveWordRegex(words)
      
      const text = '测试敏感测试敏感'
      const result = text.replace(regex, (match) => '*'.repeat(match.length))
      
      expect(result).toBe('************')
    })
  })
})
