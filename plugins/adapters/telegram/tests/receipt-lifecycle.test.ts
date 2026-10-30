import { expect, it, vi } from 'vitest';
import { telegramFixture } from './fixture.js';
import { resolveTelegramConfig } from '../src/protocol.js';
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

it('owns the complete parsed update while a role lookup awaits, so close drains the accepted message', async () => {
  const entered = gate(), role = gate(), receive = vi.fn(async () => undefined);
  const f = await telegramFixture({ id: 'telegram-receipt' as never,
    config: resolveTelegramConfig({ id: 'bot', token: 'synthetic', polling: false, webhook: { domain: 'https://fixture.invalid', secretToken: 'synthetic' } }),
    http: { route: () => () => undefined } as never,
    fetch: async (url, init) => {
      let result: unknown = true;
      if (url.endsWith('/getMe')) result = { id: 1, username: 'bot' };
      if (url.endsWith('/getChatMember')) { entered.resolve(); await role.promise; init?.signal?.throwIfAborted(); result = { status: 'member' }; }
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result }), json: async () => ({}) };
    },
  }, { receive });
  await f.start(); f.open();
  const raw = { update_id: 1, message: { message_id: 1, date: 1700000000, text: 'accepted', from: { id: 2 }, chat: { id: -3, type: 'supergroup' as const } } };
  const receiving = f.endpoint.handleUpdate(raw), observed = receiving.catch(error => error);
  await entered.promise;
  let finished = false; const closing = f.close().then(() => { finished = true; });
  try {
    await new Promise(resolve => setImmediate(resolve)); expect(finished).toBe(false);
    role.resolve(); await receiving; await closing;
    expect(receive).toHaveBeenCalledOnce(); expect(receive).toHaveBeenCalledWith(expect.objectContaining({ event: raw }));
  } finally { role.resolve(); await observed; await closing; await f.stop(); }
});


it('cancels an accepted update role lookup on stop without dispatching or retaining the in-flight update', async () => {
  const entered = gate(), role = gate(), receive = vi.fn(async () => undefined);
  let lookupSignal: AbortSignal | undefined;
  const f = await telegramFixture({
    id: 'telegram-stop-receipt' as never,
    config: resolveTelegramConfig({ id: 'bot', token: 'synthetic', polling: false, webhook: { domain: 'https://fixture.invalid', secretToken: 'synthetic' } }),
    http: { route: () => () => undefined } as never,
    fetch: async (url, init) => {
      let result: unknown = true;
      if (url.endsWith('/getMe')) result = { id: 1, username: 'bot' };
      if (url.endsWith('/getChatMember')) {
        lookupSignal = init?.signal;
        entered.resolve(); await role.promise;
        lookupSignal?.throwIfAborted(); result = { status: 'member' };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result }), json: async () => ({}) };
    },
  }, { receive });
  await f.start(); f.open();
  const raw = { update_id: 2, message: { message_id: 2, date: 1700000000, text: 'cancelled', from: { id: 2 }, chat: { id: -3, type: 'supergroup' as const } } };
  const receiving = f.endpoint.handleUpdate(raw), observed = receiving.catch(error => error);
  await entered.promise;
  const stopping = f.stop();
  try {
    await stopping;
    expect(lookupSignal?.aborted).toBe(true);
    expect(await observed).toBeInstanceOf(Error);
    expect(receive).not.toHaveBeenCalled();
    role.resolve();
    await new Promise(resolve => setImmediate(resolve));
    expect(receive).not.toHaveBeenCalled();
  } finally { role.resolve(); await observed; await stopping; }
});
