import { describe, expect, it } from 'vitest';
import { segment } from '../src/utils.js';

describe('segment.html', () => {
  it('创建 html 消息段', () => {
    const seg = segment.html({ html: '<div>card</div>', width: 540 });
    expect(seg).toMatchObject({
      type: 'html',
      data: { html: '<div>card</div>', width: 540 },
    });
  });

  it('raw 预览使用自动剥离摘要', () => {
    const preview = segment.raw(
      segment.html({ html: '<div>今日本群消息统计</div><div>120</div>' }),
    );
    expect(preview).toMatch(/^\[html-card\]/);
    expect(preview).toContain('今日本群消息统计');
    expect(preview).toContain('120');
    expect(preview.length).toBeLessThanOrEqual(80 + '[html-card] '.length + 5);
  });

  it('raw 预览优先显式 text', () => {
    const preview = segment.raw(
      segment.html({ html: '<div>ignored</div>', text: 'custom fallback text' }),
    );
    expect(preview).toBe('custom fallback text');
  });
});
