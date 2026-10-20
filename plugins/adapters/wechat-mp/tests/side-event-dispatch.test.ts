import { getAdapterLogger } from '@zhin.js/logger';
import type { IncomingNotice } from '@zhin.js/core';
import { receiveWeChatMpSideEvent } from '../src/side-event-dispatch.js';

it.each(['subscribe', 'unsubscribe', 'CLICK', 'SCAN'])('keeps %s in the fan private conversation with millisecond time', (Event) => {
  const emit = vi.fn(async (_name: string, _payload: unknown) => undefined);
  const raw = { ToUserName: 'bot', FromUserName: 'fan', MsgType: 'event', Event, CreateTime: 1700000000 };
  receiveWeChatMpSideEvent(emit, 'bot', raw, getAdapterLogger('wechat-mp', 'test'));
  const notice = emit.mock.calls[0]![1] as IncomingNotice;
  expect(notice).toMatchObject({ conversation: { kind: 'private', id: 'fan' }, timestamp: 1700000000000, metadata: raw });
});

it.each([0, -1, Number.NaN])('uses current milliseconds for invalid CreateTime %s', (CreateTime) => {
  const emit = vi.fn(async (_name: string, _payload: unknown) => undefined);
  receiveWeChatMpSideEvent(emit, 'bot', { ToUserName: 'bot', FromUserName: 'fan', MsgType: 'event', Event: 'CLICK', CreateTime }, getAdapterLogger('wechat-mp', 'test'));
  expect((emit.mock.calls[0]![1] as IncomingNotice).timestamp).toBeGreaterThan(1000000000000);
});
