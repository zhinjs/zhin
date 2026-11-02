import { formatOutboundPlan } from '../src/protocol.js';

const text = (value: string) => ({ type: 'text', data: { text: value } });
const media = (type: string) => ({ type, data: { media: { kind: 'file', value: `${type}-file` } } });

describe('Telegram ordered rich replies', () => {
  it('keeps trailing text after an image while preserving the preceding caption', () => {
    const { actions } = formatOutboundPlan('1', [text('before'), media('image'), text('after')]);
    expect(actions).toMatchObject([
      { method: 'sendPhoto', params: { caption: 'before', photo: 'image-file' } },
      { method: 'sendMessage', params: { text: 'after' } },
    ]);
  });

  it('flushes text around a sticker that cannot carry a caption', () => {
    const { actions } = formatOutboundPlan('1', [text('before'), media('sticker'), text('after')]);
    expect(actions).toMatchObject([
      { method: 'sendMessage', params: { text: 'before' } },
      { method: 'sendSticker', params: { sticker: 'sticker-file' } },
      { method: 'sendMessage', params: { text: 'after' } },
    ]);
  });

  it('retains reply routing and attaches trailing buttons to the trailing text', () => {
    const { actions } = formatOutboundPlan('1', [
      { type: 'reply', data: { message_id: '9' } },
      media('image'), text('after'),
      { type: 'keyboard', data: { rows: [[{ label: 'Continue', payload: 'continue' }]] } },
    ]);
    expect(actions).toMatchObject([
      { method: 'sendPhoto', params: { reply_parameters: { message_id: 9 } } },
      { method: 'sendMessage', params: { text: 'after', reply_parameters: { message_id: 9 },
        reply_markup: { inline_keyboard: [[{ text: 'Continue', callback_data: 'continue' }]] } } },
    ]);
  });
});
