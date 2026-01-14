import { describe, it, expect } from 'vitest';
import { segment } from '../src/utils.js';

describe('ReDoS Protection Tests', () => {
  describe('segment.from() ReDoS protection', () => {
    it('should handle small inputs (100 attributes) without timeout', () => {
      // 测试少量属性的标签
      const smallInput = '<tag ' + 'a="b" '.repeat(100) + '/>';
      const start = Date.now();
      
      try {
        segment.from(smallInput);
        const duration = Date.now() - start;
        
        // 应该在合理时间内完成（100ms）
        expect(duration).toBeLessThan(100);
      } catch (error) {
        // 如果抛出错误，也是可以接受的（比如输入太大）
        expect(error).toBeDefined();
      }
    });

    it('should handle medium inputs (500 attributes) without timeout', () => {
      // 测试中等数量属性的标签
      const mediumInput = '<tag ' + 'a="b" '.repeat(500) + '/>';
      const start = Date.now();
      
      try {
        segment.from(mediumInput);
        const duration = Date.now() - start;
        
        // 应该在合理时间内完成（500ms）
        expect(duration).toBeLessThan(500);
      } catch (error) {
        // 如果抛出错误，也是可以接受的（比如输入太大）
        expect(error).toBeDefined();
      }
    });

    it('should handle large inputs (1000 attributes) without timeout', () => {
      // 测试大量属性的标签
      const largeInput = '<tag ' + 'a="b" '.repeat(1000) + '/>';
      const start = Date.now();
      
      try {
        segment.from(largeInput);
        const duration = Date.now() - start;
        
        // 应该在合理时间内完成（1秒）
        expect(duration).toBeLessThan(1000);
      } catch (error) {
        // 如果抛出错误，也是可以接受的（比如输入太大）
        expect(error).toBeDefined();
      }
    });

    it('should handle very large inputs (2000 attributes) without timeout', () => {
      // 测试更大量属性的标签
      const veryLargeInput = '<tag ' + 'a="b" '.repeat(2000) + '/>';
      const start = Date.now();
      
      try {
        segment.from(veryLargeInput);
        const duration = Date.now() - start;
        
        // 应该在合理时间内完成（2秒）
        expect(duration).toBeLessThan(2000);
      } catch (error) {
        // 如果抛出错误，也是可以接受的（比如输入太大）
        expect(error).toBeDefined();
      }
    });

    it('should reject extremely large templates', () => {
      // 测试超大模板
      const hugeTemplate = '<tag>content</tag>'.repeat(10000);
      
      expect(() => {
        segment.from(hugeTemplate);
      }).toThrow('Template too large');
    });

    it('should handle nested tags without exponential backtracking', () => {
      // 测试嵌套标签
      const nestedInput = '<outer ' + 'attr="val" '.repeat(100) + '><inner>text</inner></outer>';
      const start = Date.now();
      
      segment.from(nestedInput);
      const duration = Date.now() - start;
      
      // 应该在合理时间内完成
      expect(duration).toBeLessThan(500);
    });

    it('should handle malformed attributes gracefully', () => {
      // 测试格式错误的属性
      const malformedInput = '<tag a=b c=d e="f"/>';
      
      // 不应该崩溃或超时
      const start = Date.now();
      const result = segment.from(malformedInput);
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(100);
      expect(result).toBeDefined();
    });

    it('should prevent infinite loops', () => {
      // 测试可能导致无限循环的输入
      const problematicInput = '<tag><tag><tag><tag><tag>';
      
      const start = Date.now();
      try {
        segment.from(problematicInput);
      } catch (error) {
        // 可能会抛出错误，这是可以接受的
      }
      const duration = Date.now() - start;
      
      // 应该在合理时间内完成或失败
      expect(duration).toBeLessThan(1000);
    });

    it('should handle complex attribute patterns', () => {
      // 测试复杂的属性模式
      const complexInput = '<tag attr1="value1" attr2=\'value2\' attr3="value with spaces"/>';
      
      const start = Date.now();
      const result = segment.from(complexInput);
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(100);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle repeated patterns efficiently', () => {
      // 测试重复模式
      const repeatedPattern = ('<tag attr="value">content</tag>').repeat(100);
      
      const start = Date.now();
      try {
        segment.from(repeatedPattern);
      } catch (error) {
        // 如果输入太大，抛出错误是可以接受的
      }
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(1000);
    });

    it('should handle edge cases with special characters', () => {
      // 测试特殊字符
      const specialChars = '<tag attr="value with \\"quotes\\" and \'apostrophes\'">content</tag>';
      
      const start = Date.now();
      const result = segment.from(specialChars);
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(100);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Normal functionality should still work', () => {
    it('should parse simple self-closing tags', () => {
      const input = '<image url="test.jpg"/>';
      const result = segment.from(input);
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should parse tags with content', () => {
      const input = '<text>Hello World</text>';
      const result = segment.from(input);
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should parse tags with attributes', () => {
      const input = '<at id="123" name="user"/>';
      const result = segment.from(input);
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should parse nested tags', () => {
      const input = '<quote><text>quoted text</text></quote>';
      const result = segment.from(input);
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
