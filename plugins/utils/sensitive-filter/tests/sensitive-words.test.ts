import { describe, it, expect } from 'vitest'
import {
  createSensitiveWordRegex,
  getEnabledWords,
  type SensitiveFilterOptions,
  politicalWords,
  violenceWords,
  pornWords,
  homophoneWords,
} from '../src/sensitive-words'

describe('敏感词过滤测试', () => {
  describe('敏感词正则表达式', () => {
    it('应该创建有效的正则表达式', () => {
      const words = ['测试', '敏感词']
      const regex = createSensitiveWordRegex(words)
      
      expect(regex).toBeInstanceOf(RegExp)
      // 使用 match 方法测试，因为正则表达式带有 'g' 标志，test() 方法会有状态问题
      expect('这是测试'.match(regex)).toBeTruthy()
      expect('这是敏感词'.match(regex)).toBeTruthy()
      expect('这是正常内容'.match(regex)).toBeNull()
    })

    it('应该转义特殊字符', () => {
      const words = ['$test', '.*word']
      const regex = createSensitiveWordRegex(words)
      
      expect('$test'.match(regex)).toBeTruthy()
      expect('.*word'.match(regex)).toBeTruthy()
    })

    it('应该不区分大小写', () => {
      const words = ['Test']
      const regex = createSensitiveWordRegex(words)
      
      expect('test'.match(regex)).toBeTruthy()
      expect('TEST'.match(regex)).toBeTruthy()
      expect('TeSt'.match(regex)).toBeTruthy()
    })
  })

  describe('获取启用的敏感词', () => {
    it('应该返回所有启用的敏感词', () => {
      const options: SensitiveFilterOptions = {
        political: true,
        violence: true,
        porn: true,
        homophone: true,
      }
      
      const words = getEnabledWords(options)
      
      expect(words.length).toBeGreaterThan(0)
      expect(words).toContain(politicalWords[0])
      expect(words).toContain(violenceWords[0])
      expect(words).toContain(pornWords[0])
      expect(words).toContain(homophoneWords[0])
    })

    it('应该只返回启用类别的敏感词', () => {
      const options: SensitiveFilterOptions = {
        political: true,
        violence: false,
        porn: false,
        homophone: false,
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
    
    it('应该正确过滤谐音词', () => {
      const options: SensitiveFilterOptions = {
        political: false,
        violence: false,
        porn: false,
        prohibited: false,
        fraud: false,
        illegal: false,
        homophone: true,
      }
      
      const words = getEnabledWords(options)
      
      expect(words).toContain('GCD')
      expect(words).toContain('sb')
      expect(words).toContain('cao')
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
      
      // 文本共8个字符（每个中文字符算1个）："测试"(2) + "敏感"(2) + "测试"(2) + "敏感"(2) = 8
      expect(result).toBe('********')
    })
  })

  describe('谐音词和变体词过滤', () => {
    it('应该检测拼音缩写', () => {
      const words = ['GCD', 'FLG', 'CNM']
      const regex = createSensitiveWordRegex(words)
      
      expect('这是GCD的东西'.match(regex)).toBeTruthy()
      expect('flg是邪教'.match(regex)).toBeTruthy()
      expect('cnm骂人'.match(regex)).toBeTruthy()
    })

    it('应该检测谐音变体', () => {
      const words = ['共惨党', '政腐', '尼玛']
      const regex = createSensitiveWordRegex(words)
      
      expect('共惨党说法'.match(regex)).toBeTruthy()
      expect('政腐机关'.match(regex)).toBeTruthy()
      expect('尼玛真是'.match(regex)).toBeTruthy()
    })

    it('应该检测符号分隔词', () => {
      const words = ['法_轮_功', '六_四', '毒_品']
      const regex = createSensitiveWordRegex(words)
      
      expect('法_轮_功邪教'.match(regex)).toBeTruthy()
      expect('六_四事件'.match(regex)).toBeTruthy()
      expect('毒_品交易'.match(regex)).toBeTruthy()
    })

    it('应该替换谐音词', () => {
      const words = ['sb', 'cao', 'fuck']
      const regex = createSensitiveWordRegex(words)
      
      const text = '你个sb，去cao，fuck off'
      const result = text.replace(regex, (match) => '*'.repeat(match.length))
      
      expect(result).toContain('**')
      expect(result).toContain('***')
      expect(result).toContain('****')
      expect(result).not.toContain('sb')
      expect(result).not.toContain('cao')
      expect(result).not.toContain('fuck')
    })
  })
})
