import { describe, expect, it } from 'vitest';
import { displayWidth, padDisplayEnd, truncateDisplayEnd, wrapDisplayText } from '../src/terminal-width.js';

describe('terminal-width', () => {
  it('counts CJK as double width', () => {
    expect(displayWidth('插件')).toBe(4);
    expect(displayWidth('abc')).toBe(3);
  });

  it('counts emoji with variation selector as single cell width', () => {
    expect(displayWidth('📅')).toBe(2);
    expect(displayWidth('👁️')).toBe(2);
    expect(displayWidth('🖼️')).toBe(2);
  });

  it('pads by display width', () => {
    expect(displayWidth(padDisplayEnd('配置', 8))).toBe(8);
  });

  it('wrapDisplayText does not split emoji', () => {
    const text = '工具 - 📅 **签到** — 查询';
    const lines = wrapDisplayText(text, 12);
    for (const line of lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(12);
    }
    expect(lines.join('')).toBe(text);
  });

  it('truncateDisplayEnd does not split emoji', () => {
    const truncated = truncateDisplayEnd('你好📅世界', 5);
    expect(displayWidth(truncated)).toBeLessThanOrEqual(5);
    expect(truncated.endsWith('…')).toBe(true);
  });
});
