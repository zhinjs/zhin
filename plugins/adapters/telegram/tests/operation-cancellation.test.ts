import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { telegramDeliveryFixture } from './fixture.js';
import { resolveTelegramConfig } from '../src/protocol.js';
import type { TelegramFetch } from '../src/telegram-client.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture() {
  let signal!: AbortSignal;
  const calls: string[] = [];
  const fetch: TelegramFetch = async (url, init) => {
    calls.push(url); signal = init!.signal!;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const bot = await telegramDeliveryFixture({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'telegram'),
    config: resolveTelegramConfig({ id: 'synthetic', token: 'synthetic-token', polling: false, webhook: { domain: 'https://synthetic.invalid', secretToken: 'synthetic' } }), fetch,
  });
  cleanups.push(() => bot.stop());
  const conversation = { endpoint: { adapter: 'telegram', id: bot.canonicalId }, kind: 'private' as const, id: 'peer' };
  return { bot, conversation, calls, signal: () => signal };
}
it('cancels the actual send transport for one caller', async () => {
  const f = await fixture(), caller = new AbortController();
  const send = f.bot.send({ conversation: f.conversation, payload: 'message', signal: caller.signal });
  const rejected = expect(send).rejects.toMatchObject({ disposition: 'unknown' });
  await vi.waitFor(() => expect(f.calls).toHaveLength(1));
  caller.abort(); await rejected;
  expect(f.signal().aborted).toBe(true);
});
it('cancels a canonical recall in its actual transport', async () => {
  const f = await fixture(), caller = new AbortController();
  const recall = f.bot.index.control(f.bot.canonicalId, 'recall').recall!({ message: { conversation: f.conversation, id: '123' }, signal: caller.signal });
  const rejected = expect(recall).rejects.toMatchObject({ disposition: 'unknown' });
  await vi.waitFor(() => expect(f.calls).toHaveLength(1));
  caller.abort(); await rejected;
  expect(f.signal().aborted).toBe(true);
});
