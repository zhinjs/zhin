import { expect, it, vi } from 'vitest';
import { createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { createJuejinHarness } from './juejin-harness.js';
import { ARTICLE, comment, fakeFetch } from './juejin-fake.js';
import type { JuejinEndpoint } from '../src/endpoint.js';

// #1250 adapter-inbound-deadlock: a turn started by one comment waits for the reader's answer, which only
// the next poll can fetch; pollOnce must not wait for that turn.
it('finishes a poll once its new comments were handed over, so the next poll can fetch the answer', async () => {
  const fake = fakeFetch({ pages: [[comment('7000000000000000100')],
    [comment('7000000000000000200'), comment('7000000000000000100')],
    [comment('7000000000000000300'), comment('7000000000000000200'), comment('7000000000000000100')]] });
  let answered!: () => void;
  const answer = new Promise<void>(resolve => { answered = resolve; });
  const receive = vi.fn(async (payload: { message?: { id?: string } }) => {
    if (payload.message?.id === '7000000000000000300') { answered(); return; }
    await answer; // the turn waits for the reader's reply
  });
  const harness = await createJuejinHarness({ id: 'jj', articles: [ARTICLE], cookie: 'sessionid=offline' },
    { fetch: fake.fetch, now: () => 1_000_000 }, createTestEndpointEventGateway({ receive: async (event) => {
      if (event.name !== 'message.receive') return undefined;
      event.accepted?.(); // as the Runtime does once the message is recorded, before its dispatch
      return receive(event.payload as { message?: { id?: string } });
    } }));
  const endpoint = harness.endpoint as JuejinEndpoint;
  const settledWithin = (promise: Promise<unknown>) => Promise.race([promise.then(() => true),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1_000))]);
  try {
    await endpoint.pollOnce(); // baseline
    expect(await settledWithin(endpoint.pollOnce())).toBe(true);
    expect(await settledWithin(endpoint.pollOnce())).toBe(true);
    await answer;
    expect(receive.mock.calls.map(([payload]) => payload.message?.id)).toEqual(['7000000000000000200', '7000000000000000300']);
  } finally { answered(); }
});
