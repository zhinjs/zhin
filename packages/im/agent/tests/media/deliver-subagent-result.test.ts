import { describe, expect, it, vi } from 'vitest';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import { deliverSubagentResult } from '../../src/media/deliver-subagent-result.js';

describe('deliverSubagentResult', () => {
  it('generate_image 工具结果应随回告一并发出图片段', async () => {
    const send = vi.fn(async () => 'msg-1');
    await deliverSubagentResult({
      origin: {
        message: mockCommMessage({
          adapter: 'sandbox',
          endpoint: 'b1',
          senderId: 'u1',
          scope: 'group',
          sceneId: 's1',
        }),
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

  it('does not read a local file or fetch a URL that the result text references', async () => {
    const send = vi.fn(async () => 'msg-2');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await deliverSubagentResult({
        origin: {
          message: mockCommMessage({ adapter: 'sandbox', endpoint: 'b1', senderId: 'u1', scope: 'group', sceneId: 's1' }),
        },
        delivery: {
          text: '',
          elements: [
            { type: 'file', url: '/etc/hosts' } as never,
            { type: 'image', url: 'https://example.com/a.png?leak=1' } as never,
          ],
        },
        send,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      const sent = JSON.stringify(send.mock.calls);
      expect(sent).not.toContain('localhost');
      expect(sent).not.toMatch(/"type":"file"/);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
