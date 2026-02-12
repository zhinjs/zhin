/**
 * AI Output 模块测试
 */
import { describe, it, expect } from 'vitest';
import { parseOutput, renderToPlainText, renderToSatori } from '../../src/ai/output.js';

describe('parseOutput', () => {
  it('纯文本应返回单个 TextElement', () => {
    const result = parseOutput('Hello, world!');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'text', content: 'Hello, world!', format: 'markdown' });
  });

  it('空字符串应返回空白 TextElement', () => {
    const result = parseOutput('');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'text', content: '', format: 'plain' });
  });

  it('应解析图片 ![alt](url)', () => {
    const result = parseOutput('看看这张图 ![cat](https://example.com/cat.png)');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'text', content: '看看这张图' });
    expect(result[1]).toMatchObject({ type: 'image', url: 'https://example.com/cat.png', alt: 'cat' });
  });

  it('应解析音频 [audio](url)', () => {
    const result = parseOutput('[audio](https://example.com/song.mp3)');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'audio', url: 'https://example.com/song.mp3' });
  });

  it('应解析视频 [video](url)', () => {
    const result = parseOutput('这是视频 [video](https://example.com/video.mp4)');
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ type: 'video', url: 'https://example.com/video.mp4' });
  });

  it('应解析文件 [file:name](url)', () => {
    const result = parseOutput('[file:report.pdf](https://example.com/report.pdf)');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'file', url: 'https://example.com/report.pdf', name: 'report.pdf' });
  });

  it('应解析 card 代码块', () => {
    const raw = '```card\n{"title":"天气","description":"晴天"}\n```';
    const result = parseOutput(raw);
    expect(result.some(el => el.type === 'card')).toBe(true);
    const card = result.find(el => el.type === 'card')!;
    expect(card).toMatchObject({ type: 'card', title: '天气', description: '晴天' });
  });

  it('无效 card JSON 应降级为文本', () => {
    const raw = '```card\n{invalid json}\n```';
    const result = parseOutput(raw);
    expect(result.some(el => el.type === 'text')).toBe(true);
  });

  it('应处理混合内容', () => {
    const raw = '看看这个 ![](https://img.png) 更多文字';
    const result = parseOutput(raw);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.some(el => el.type === 'image')).toBe(true);
  });
});

describe('renderToPlainText', () => {
  it('应渲染文本元素', () => {
    expect(renderToPlainText([{ type: 'text', content: 'Hello' }])).toBe('Hello');
  });

  it('应渲染图片为 [图片: alt]', () => {
    const result = renderToPlainText([{ type: 'image', url: 'url', alt: '猫' }]);
    expect(result).toBe('[图片: 猫]');
  });

  it('应渲染音频的 fallbackText', () => {
    const result = renderToPlainText([{ type: 'audio', url: 'url', fallbackText: '一段音乐' }]);
    expect(result).toBe('一段音乐');
  });

  it('应渲染卡片标题和字段', () => {
    const result = renderToPlainText([{
      type: 'card',
      title: '天气',
      description: '晴天',
      fields: [{ label: '温度', value: '25°C' }],
    }]);
    expect(result).toContain('天气');
    expect(result).toContain('晴天');
    expect(result).toContain('温度: 25°C');
  });

  it('应渲染文件为 [文件: name]', () => {
    const result = renderToPlainText([{ type: 'file', url: 'url', name: 'report.pdf' }]);
    expect(result).toContain('[文件: report.pdf]');
  });
});

describe('renderToSatori', () => {
  it('应将文本包裹在 <p> 标签中', () => {
    const result = renderToSatori([{ type: 'text', content: 'Hello' }]);
    expect(result).toBe('<p>Hello</p>');
  });

  it('应生成 <img> 标签', () => {
    const result = renderToSatori([{ type: 'image', url: 'https://img.png', alt: '猫' }]);
    expect(result).toContain('<img');
    expect(result).toContain('alt="猫"');
  });

  it('应转义 HTML 特殊字符', () => {
    const result = renderToSatori([{ type: 'text', content: '<script>alert("xss")</script>' }]);
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('应渲染卡片结构', () => {
    const result = renderToSatori([{
      type: 'card',
      title: '标题',
      description: '描述',
    }]);
    expect(result).toContain('<div class="card">');
    expect(result).toContain('<h3>标题</h3>');
    expect(result).toContain('<p>描述</p>');
  });
});
