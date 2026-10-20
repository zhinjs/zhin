import { getAdapterLogger } from '@zhin.js/logger';
import type { IncomingNotice, IncomingSystemEvent } from '@zhin.js/core';
import { receiveWecomSideEvent } from '../src/side-event-dispatch.js';

it.each(['subscribe', 'CLICK', 'enter_agent'])('uses milliseconds on the %s route', (Event) => {
  const emit = vi.fn(async (_name: string, _payload: unknown) => undefined);
  const raw = { ToUserName: 'bot', FromUserName: 'user', MsgType: 'event', Event, CreateTime: 1700000000 };
  receiveWecomSideEvent(emit, 'capability', 'bot', raw, getAdapterLogger('wecom', 'test'));
  const event = emit.mock.calls[0]![1] as IncomingNotice | IncomingSystemEvent;
  expect(event.timestamp).toBe(1700000000000);
  expect(event.metadata).toEqual(raw);
  if (Event === 'enter_agent') {
    expect(emit.mock.calls[0]![0]).toBe('system.receive');
    expect(event).not.toHaveProperty('conversation');
  } else {
    expect(event).toMatchObject({ conversation: { kind: 'private', id: 'user' } });
  }
});
