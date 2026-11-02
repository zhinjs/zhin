import { formatOutboundMessages } from '../src/outbound.js';

const image = { type: 'image', data: { media: { kind: 'base64', value: 'QUJD' } } };
const markdown = (content: string) => ({ type: 'markdown', data: { content } });

describe('QQ ordered rich replies', () => {
  it('keeps Markdown before and after an unembeddable image in separate messages', () => {
    const result = formatOutboundMessages([markdown('before'), image, markdown('after')]);
    expect(result).toEqual([
      { type: 'markdown', data: { content: 'before' } },
      { type: 'image', data: { file: 'base64://QUJD' } },
      { type: 'markdown', data: { content: 'after' } },
    ]);
  });

  it('keeps each embedded public image between its surrounding Markdown', () => {
    const url = 'https://example.invalid/image.png';
    const result = formatOutboundMessages([
      markdown('before'),
      { type: 'image', data: { media: { kind: 'url', value: url } } },
      markdown('after'),
    ], { imageSizes: new Map([[url, { width: 10, height: 20 }]]) });
    expect(result).toEqual([{ type: 'markdown', data: {
      content: `before\n\n![图片 #10px #20px](${url})\n\nafter`,
    } }]);
  });

  it('carries the explicit reply through every physical message without merging across media', () => {
    const result = formatOutboundMessages([
      { type: 'reply', data: { message_id: 'source' } },
      markdown('before'), image, markdown('after'),
    ]);
    expect(result).toHaveLength(3);
    for (const message of result) {
      expect(message).toContainEqual({ type: 'reply', data: { id: 'source' } });
    }
    expect(JSON.stringify(result[0])).toContain('before');
    expect(JSON.stringify(result[1])).toContain('image');
    expect(JSON.stringify(result[2])).toContain('after');
  });
});
