import { rootPluginId } from '@zhin.js/plugin-runtime';
import { createRateLimitedOutbound } from '../../src/room/room-send-limiter.js';
import { createRoomBus } from '../../src/room/room-bus.js';
import { registryOf, ACCOUNTS } from './room-fixtures.js';

const request = (endpoint: string, text = 'hi') => ({
  conversation: { endpoint: { id: endpoint, adapter: 'qq' }, kind: 'group' as const, id: '100' },
  requester: rootPluginId(),
  content: text,
});

function setup(extra: Record<string, unknown> = {}) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const sent: unknown[] = [];
  const inner = { send: async (r: unknown) => { sent.push(r); return { status: 'sent' as const }; } };
  const outbound = createRateLimitedOutbound({
    inner,
    accountOf: (id) => ({ e1: 'acct-1', e2: 'acct-1', e3: 'acct-3' } as Record<string, string>)[id],
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    ...extra,
  });
  return { outbound, sleeps, sent, advance: (ms: number) => { t += ms; } };
}

describe('createRateLimitedOutbound', () => {
  it('spaces consecutive sends of one account by minIntervalMs', async () => {
    const { outbound, sleeps, sent } = setup({ minIntervalMs: 1000 });
    await outbound.send(request('e1'));
    await outbound.send(request('e1'));
    // e2 shares the account acct-1, so it is spaced as well
    await outbound.send(request('e2'));
    expect(sleeps).toEqual([1000, 1000]);
    expect(sent).toHaveLength(3);
  });

  it('postpones sends beyond maxPerMinute until the window rolls, or refuses past maxWaitMs', async () => {
    const { outbound, sleeps, sent } = setup({ minIntervalMs: 0, maxPerMinute: 2, maxWaitMs: 5000 });
    await outbound.send(request('e1'));
    await outbound.send(request('e1'));
    const receipt = await outbound.send(request('e1'));
    expect(receipt).toMatchObject({ status: 'rejected', failure: { code: 'room_send_rate_limited', retryable: true } });
    expect(sent).toHaveLength(2);
    expect(sleeps).toEqual([]);

    const patient = setup({ minIntervalMs: 0, maxPerMinute: 2, maxWaitMs: 60_000 });
    await patient.outbound.send(request('e1'));
    await patient.outbound.send(request('e1'));
    await patient.outbound.send(request('e1'));
    expect(patient.sleeps).toEqual([60_000]);
    expect(patient.sent).toHaveLength(3);
  });

  it('keeps accounts independent and falls back to the endpoint id', async () => {
    const { outbound, sleeps } = setup({ minIntervalMs: 1000 });
    await outbound.send(request('e1'));
    await outbound.send(request('e3'));
    expect(sleeps).toEqual([]);
    await outbound.send(request('unknown'));
    await outbound.send(request('unknown'));
    expect(sleeps).toEqual([1000]);
  });

  it('fails closed when accountOf throws, without calling inner', async () => {
    const sent: unknown[] = [];
    const outbound = createRateLimitedOutbound({
      inner: { send: async (r) => { sent.push(r); return { status: 'sent' as const }; } },
      accountOf: () => { throw new Error('registry down'); },
    });
    const receipt = await outbound.send(request('e1'));
    expect(receipt).toMatchObject({ status: 'rejected', failure: { code: 'room_send_guard_error' } });
    expect(sent).toEqual([]);
  });

  it('books concurrent requests of one account in arrival order with monotonic slots', async () => {
    const t = 0;
    const order: string[] = [];
    const waits: number[] = [];
    const outbound = createRateLimitedOutbound({
      inner: { send: async (r) => { order.push(String(r.content)); return { status: 'sent' as const }; } },
      accountOf: () => 'acct',
      now: () => t,
      sleep: async (ms) => { waits.push(ms); },
      minIntervalMs: 1000,
      maxWaitMs: 10_000,
    });
    await Promise.all([1, 2, 3, 4, 5].map((n) => outbound.send(request('e1', String(n)))));
    expect(waits).toEqual([1000, 2000, 3000, 4000]);
    expect(order).toEqual(['1', '2', '3', '4', '5']);
  });

  it('applies per-account overrides', async () => {
    const { outbound, sleeps } = setup({ minIntervalMs: 1000, perAccount: { 'acct-3': { minIntervalMs: 200 } } });
    await outbound.send(request('e3'));
    await outbound.send(request('e3'));
    expect(sleeps).toEqual([200]);
  });

  it('forgets idle accounts and refuses new keys when the table is full', async () => {
    const { outbound, advance } = setup({ minIntervalMs: 0, maxPerMinute: 1000 });
    for (let i = 0; i < 1024; i += 1) await outbound.send(request(`ep-${i}`));
    expect(await outbound.send(request('ep-new'))).toMatchObject({ failure: { code: 'room_send_guard_error' } });
    advance(61_000);
    expect(await outbound.send(request('ep-new'))).toMatchObject({ status: 'sent' });
  });

  it('rejects invalid options and only exposes send', async () => {
    const inner = { send: async () => ({ status: 'sent' as const }) };
    expect(() => createRateLimitedOutbound({ inner, maxPerMinute: 0 })).toThrow(RangeError);
    expect(() => createRateLimitedOutbound({ inner, minIntervalMs: -1 })).toThrow(RangeError);
    const outbound = createRateLimitedOutbound({ inner, sleep: async () => undefined });
    expect(Object.keys(outbound)).toEqual(['send']);
    expect(await outbound.send(request('e1'))).toEqual({ status: 'sent' });
  });
});

describe('rate limiter with RoomBus', () => {
  it('reports a limited projection but still wakes subscribers', async () => {
    const sent: unknown[] = [];
    const bus = createRoomBus({
      registry: registryOf(),
      outbound: createRateLimitedOutbound({
        inner: { send: async (r) => { sent.push(r); return { status: 'sent' as const }; } },
        accountOf: (id) => ACCOUNTS[id],
        now: () => 1000,
        sleep: async () => undefined,
        minIntervalMs: 1000,
        maxPerMinute: 1,
        maxWaitMs: 0,
      }),
      requester: rootPluginId(),
      accountOf: (id) => ACCOUNTS[id],
    });
    const seen: string[] = [];
    bus.subscribe((e) => { seen.push(e.id); });
    const base = { room: 'dev', from: 'lead', to: 'res', text: 'x', at: 1 };
    expect(await bus.handoff({ ...base, id: 'h1' })).toEqual({ delivered: true, projected: true });
    const limited = await bus.handoff({ ...base, id: 'h2' });
    expect(limited).toMatchObject({ delivered: true, projected: false });
    expect(limited.projectionError).toContain('room_send_rate_limited');
    expect(seen).toEqual(['h1', 'h2']);
    expect(sent).toHaveLength(1);
  });
});
