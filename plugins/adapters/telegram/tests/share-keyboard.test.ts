import { formatOutboundActions } from '../src/protocol.js';

it('maps canonical share title, URL and description into escaped clickable HTML', () => {
  expect(formatOutboundActions(123, [{ type: 'text', data: { text: '<prefix>' } }, { type: 'share', data: { url: 'https://example.com/?a=1&b=2', title: 'A < B', description: '<description>' } }])).toEqual([{
    method: 'sendMessage', params: { chat_id: 123, parse_mode: 'HTML', text: '&lt;prefix&gt;<a href="https://example.com/?a=1&amp;b=2">A &lt; B</a>\n&lt;description&gt;' },
  }]);
  expect(() => formatOutboundActions(123, { type: 'share', data: { url: 'javascript:alert(1)', title: 'link' } })).toThrow('HTTP(S)');
  expect(() => formatOutboundActions(123, { type: 'share', data: { url: 'https://example.com', title: 'link', image: 'https://example.com/a.png' } })).toThrow('not implemented');
});

it('preserves valid callback payloads and rejects excessive UTF-8 bytes rather than truncating identity', () => {
  const keyboard = (payload: string) => [{ type: 'text', data: { text: 'choose' } }, { type: 'keyboard', data: { rows: [[{ label: '确认', payload }]] } }];
  const payload = '中'.repeat(21);
  expect(formatOutboundActions(1, keyboard(payload))[0]).toMatchObject({ params: { reply_markup: { inline_keyboard: [[{ text: '确认', callback_data: payload }]] } } });
  for (const invalid of ['', '中'.repeat(22), 'a'.repeat(65)]) expect(() => formatOutboundActions(1, keyboard(invalid))).toThrow('1-64 UTF-8 bytes');
});
