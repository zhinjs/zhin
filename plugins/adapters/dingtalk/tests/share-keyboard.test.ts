import { formatOutboundBody } from '../src/protocol.js';
it('encodes canonical share as the DingTalk native link card', () => {
  expect(formatOutboundBody([{ type: 'share', data: { title: 'Share', url: 'https://example.com/article', description: 'Details', image: 'https://example.com/image.png' } }])).toEqual({ msgtype: 'link', link: { title: 'Share', text: 'Details', messageUrl: 'https://example.com/article', picUrl: 'https://example.com/image.png' } });
});
it.each(['javascript:alert(1)', '', 'file:///private/file'])('rejects invalid share URL %s before sending', url => {
  expect(() => formatOutboundBody([{ type: 'share', data: { title: 'Share', url } }])).toThrow('HTTP(S) URL');
});
it('rejects multiple cards instead of silently losing a share', () => {
  expect(() => formatOutboundBody([{ type: 'share', data: { title: 'First', url: 'https://example.com/first' } }, { type: 'share', data: { title: 'Second', url: 'https://example.com/second' } }])).toThrow('one link card');
});
it('distinguishes unimplemented canonical callbacks from navigation-only actionCard buttons', () => {
  expect(() => formatOutboundBody([{ type: 'keyboard', data: { rows: [[{ label: 'Yes', payload: 'callback' }]] } }])).toThrow('interactive card template');
});

it('preserves surrounding text in the single link card', () => {
  expect(formatOutboundBody([{ type: 'text', data: { text: 'probe-marker' } }, { type: 'share', data: { title: 'Share', url: 'https://example.com', description: 'Details' } }])).toMatchObject({ msgtype: 'link', link: { text: 'probe-marker\nDetails' } });
});

it.each(['audio', 'artist', 'duration', 'config'])('rejects rich share %s before losing its semantics', key => {
  expect(() => formatOutboundBody([{ type: 'text', data: { text: 'marker' } }, { type: 'share', data: { url: 'https://example.com', title: 'share', [key]: key === 'duration' ? 1 : key === 'config' ? { appid: 1 } : 'value' } }])).toThrow(expect.objectContaining({ code: 'unsupported_operation', disposition: 'not_sent' }));
});
