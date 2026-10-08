import { formatOutboundSegments } from '../src/protocol.js';
it.each(['markdown', 'keyboard'])('rejects unsupported %s before wire sending', type => {
  expect(() => formatOutboundSegments([{ type: 'text', data: { text: 'probe' } }, { type, data: { content: 'sample' } }])).toThrow(expect.objectContaining({ code: 'unsupported_operation', disposition: 'not_sent' }));
});
it('maps canonical share title/description/url to standard OneBot11 fields', () => {
  expect(formatOutboundSegments([{ type: 'share', data: { url: 'https://zhin.dev', title: 'Zhin', description: '描述', image: 'https://zhin.dev/image.png' } }])).toEqual([{ type: 'share', data: { url: 'https://zhin.dev', title: 'Zhin', content: '描述', image: 'https://zhin.dev/image.png' } }]);
});

it.each(['audio', 'artist', 'duration', 'config'])('rejects rich share %s before losing its semantics', key => {
  expect(() => formatOutboundSegments([{ type: 'text', data: { text: 'marker' } }, { type: 'share', data: { url: 'https://example.com', title: 'share', [key]: key === 'duration' ? 1 : key === 'config' ? { appid: 1 } : 'value' } }])).toThrow(expect.objectContaining({ code: 'unsupported_operation', disposition: 'not_sent' }));
});
