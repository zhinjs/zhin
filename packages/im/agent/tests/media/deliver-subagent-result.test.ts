import { describe, expect, it, vi } from 'vitest';
import { deliverSubagentResult } from '../../src/media/deliver-subagent-result.js';

describe('deliverSubagentResult', () => {
  it('generate_image 工具结果应随回告一并发出图片段', async () => {
    const send = vi.fn(async () => 'msg-1');
    await deliverSubagentResult({
      origin: {
        platform: 'sandbox',
        botId: 'b1',
        sceneId: 's1',
        senderId: 'u1',
        sceneType: 'group',
      },
      delivery: {
        text: '[后台任务完成]\n\n结果:\n已生成图片',
        toolCalls: [
          {
            tool: 'generate_image',
            result: { image: 'aGVsbG8=', mime: 'image/png' },
          },
        ],
      },
      send,
    });
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(1);
    const opts = send.mock.calls[0]![0];
    const content = opts.content;
    const segments = Array.isArray(content) ? content : [content];
    expect(segments.some(s => typeof s === 'object' && s !== null && 'type' in s && s.type === 'image')).toBe(true);
  });
});
