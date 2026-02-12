/**
 * ToneDetector 测试
 */
import { describe, it, expect } from 'vitest';
import { detectTone, type Tone } from '../../src/ai/tone-detector.js';

describe('detectTone', () => {
  it('空消息应返回 neutral', () => {
    const result = detectTone('');
    expect(result.tone).toBe('neutral');
    expect(result.hint).toBe('');
  });

  it('普通消息应返回 neutral', () => {
    const result = detectTone('你好，请帮我查一下天气');
    expect(result.tone).toBe('neutral');
  });

  describe('frustrated（沮丧/受挫）', () => {
    it('应检测负面关键词', () => {
      expect(detectTone('这个bug怎么回事').tone).toBe('frustrated');
      expect(detectTone('又错了，搞不定').tone).toBe('frustrated');
      expect(detectTone('不行啊，还是不对').tone).toBe('frustrated');
    });

    it('应检测大量感叹号', () => {
      expect(detectTone('到底怎么办!!!').tone).toBe('frustrated');
    });

    it('应检测大量大写字母', () => {
      const result = detectTone('WHY IS THIS NOT WORKING');
      expect(result.tone).toBe('frustrated');
    });

    it('hint 应包含共情建议', () => {
      const result = detectTone('怎么回事啊');
      expect(result.hint).toContain('耐心');
    });
  });

  describe('urgent（紧急）', () => {
    it('应检测紧急关键词', () => {
      expect(detectTone('急！请马上帮我处理').tone).toBe('urgent');
      expect(detectTone('赶紧看一下这个问题').tone).toBe('urgent');
    });

    it('hint 应建议直接给出方案', () => {
      const result = detectTone('紧急情况，尽快');
      expect(result.hint).toContain('效率');
    });
  });

  describe('sad（悲伤/低落）', () => {
    it('应检测悲伤关键词', () => {
      expect(detectTone('好难过啊').tone).toBe('sad');
      expect(detectTone('唉，不开心').tone).toBe('sad');
    });

    it('应检测省略号', () => {
      expect(detectTone('算了吧......好吧...').tone).toBe('sad');
    });
  });

  describe('excited（兴奋/开心）', () => {
    it('应检测正面关键词', () => {
      expect(detectTone('太好了！成功了！').tone).toBe('excited');
      expect(detectTone('太棒了，完美！').tone).toBe('excited');
    });
  });

  describe('questioning（提问）', () => {
    it('应检测多个问号', () => {
      expect(detectTone('这是什么？为什么？').tone).toBe('questioning');
    });

    it('短消息带问号应识别为提问', () => {
      expect(detectTone('为什么？').tone).toBe('questioning');
    });
  });
});
