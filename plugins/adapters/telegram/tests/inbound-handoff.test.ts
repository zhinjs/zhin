import { expect, it, vi } from 'vitest';
import { createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { telegramFixture } from './fixture.js';
import { resolveTelegramConfig, type TelegramUpdate } from '../src/protocol.js';

const reply = (result: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result }), json: async () => ({}) });

// #1250 adapter-inbound-deadlock: a message's dispatch lasts its whole Agent turn, and that turn may be
// waiting for the very next update (the confirm card's inline button). The poll loop must fetch it.
it('fetches and admits the next update while the previous update\'s turn is still running', async () => {
  const batches: TelegramUpdate[][] = [
    [{ update_id: 10, message: { message_id: 1, date: 1700000000, text: 'run it', from: { id: 2 }, chat: { id: 2, type: 'private' } } }],
    [{ update_id: 11, callback_query: { id: 'cb', from: { id: 2 }, data: 'confirm:yes',
      message: { message_id: 3, date: 1700000001, chat: { id: 2, type: 'private' } } } } as TelegramUpdate],
  ];
  const offsets: unknown[] = [];
  let opened!: () => void;
  const open = new Promise<void>(resolve => { opened = resolve; });
  let answered!: () => void;
  const answer = new Promise<void>(resolve => { answered = resolve; });
  const receive = vi.fn(async (payload: unknown) => {
    const metadata = (payload as { metadata?: { eventType?: string } }).metadata;
    if (metadata?.eventType === 'callback_query') { answered(); return; }
    await answer; // the turn waits for the button press
  });
  const f = await telegramFixture({ id: 'telegram-handoff' as never,
    config: resolveTelegramConfig({ id: 'bot', token: 'synthetic', polling: true }),
    fetch: async (url, init) => {
      if (url.endsWith('/getMe')) return reply({ id: 1, username: 'bot' });
      if (url.endsWith('/getUpdates')) {
        await open;
        offsets.push(JSON.parse(String(init?.body ?? '{}')).offset);
        const next = batches.shift();
        if (next) return reply(next);
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
        });
      }
      return reply(true);
    },
  }, undefined, undefined, createTestEndpointEventGateway({ receive: async (event) => {
    if (event.name !== 'message.receive') return undefined;
    event.accepted?.(); // as the Runtime does once the message is recorded, before its dispatch
    return receive(event.payload);
  } }));
  await f.start(); f.open(); opened();
  try {
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    await answer;
    // The first update was acknowledged only after it was handed to the Runtime.
    expect(offsets.slice(0, 2)).toEqual([undefined, 11]);
    await vi.waitFor(() => expect(offsets[2]).toBe(12));
  } finally {
    answered();
    await f.stop();
  }
});
