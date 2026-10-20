import { describe, expect, it } from 'vitest';
import {
  buildSubagentUserDelivery,
  stripEmbeddedMediaToolJson,
  stripRedundantMediaTokensFromText,
} from '../../src/media/subagent-user-delivery.js';

describe('subagent-user-delivery', () => {
  it('已有出站媒体时去掉正文里重复的 {image} 字样（日志 {image} 仍表示真实图片段）', () => {
    expect(
      stripRedundantMediaTokensFromText('已生成。{image}', { hasOutboundMedia: true }),
    ).toBe('已生成。');
    expect(
      stripRedundantMediaTokensFromText('已生成。{image}', { hasOutboundMedia: false }),
    ).toBe('已生成。{image}');
  });

  it('stripEmbeddedMediaToolJson 压缩正文里的巨型 generate_image JSON', () => {
    const huge = 'a'.repeat(500_000);
    const line = `【generate_image】{"image":"${huge}","mime":"image/jpeg"}`;
    const out = stripEmbeddedMediaToolJson(line);
    expect(out.length).toBeLessThan(500);
    expect(out).toContain('omitted');
    expect(out).not.toContain(huge);
  });

  it('有 generate_image 时回告简短且保留 toolCalls 供出站图片', () => {
    const d = buildSubagentUserDelivery({
      label: '画英短',
      status: 'ok',
      result: '已成功生成英国短毛猫图片！图片已发送给用户。{image}',
      toolCalls: [
        { tool: 'generate_image', result: { image: 'aGVsbG8=', mime: 'image/png' } },
      ],
    });
    expect(d.text).toContain('画英短');
    expect(d.text).not.toContain('{image}');
    expect(d.text).not.toContain('任务:');
    expect(d.toolCalls).toHaveLength(1);
  });
});
