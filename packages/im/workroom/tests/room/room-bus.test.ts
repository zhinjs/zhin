import { rootPluginId } from '@zhin.js/plugin-runtime';
import { createRoomBus, type RoomHandoffEvent } from '../../src/room/room-bus.js';
import { registryOf, ACCOUNTS, EP } from './room-fixtures.js';
import { createRoomImFixture, ACCOUNT } from './room-im-fixture.js';

const event = (over: Partial<RoomHandoffEvent> = {}): RoomHandoffEvent => ({
  id: 'h-1', room: 'dev', from: 'lead', to: 'res', text: 'please research X', at: 1, ...over,
});

function setup(send?: (request: any) => Promise<any>) {
  const requests: any[] = [];
  const warnings: string[] = [];
  const bus = createRoomBus({
    registry: registryOf(),
    outbound: {
      send: async (request) => {
        requests.push(request);
        return send ? send(request) : { status: 'sent' as const };
      },
    },
    requester: rootPluginId(),
    accountOf: (id) => ACCOUNTS[id],
    logger: { warn: (m) => { warnings.push(m); } },
  });
  return { bus, requests, warnings };
}

describe('createRoomBus', () => {
  it('rejects unknown rooms and members, self-handoff and undeclared handoff targets', async () => {
    const { bus, requests } = setup();
    for (const [over, text] of [
      [{ room: 'nope' }, 'unknown room'],
      [{ from: 'ghost' }, 'not a member'],
      [{ to: 'ghost' }, 'not a member'],
      [{ to: 'lead' }, 'itself'],
      [{ from: 'wri', to: 'res' }, 'may not hand off'],
      [{ from: 'res', to: 'lead' }, 'may not hand off'],
      [{ id: '' }, 'id'],
    ] as const) {
      const result = await bus.handoff(event(over));
      expect(result.delivered).toBe(false);
      expect(result.projected).toBe(false);
      expect(result.rejection).toContain(text);
    }
    expect(requests).toEqual([]);
  });

  it('projects through outbound.send as the from-member Bot, mentioning the target account', async () => {
    const { bus, requests } = setup();
    const result = await bus.handoff(event());
    expect(result).toEqual({ delivered: false, projected: true });
    const request = requests[0];
    expect(request.conversation).toEqual({ endpoint: { id: EP.lead, adapter: 'qq' }, kind: 'group', id: '100' });
    expect(request.requester).toBe(rootPluginId());
    expect(request.content).toEqual([
      { type: 'mention', data: { target: 'acct-res', name: 'res' } },
      { type: 'text', data: { text: ' please research X' } },
    ]);
  });

  it('falls back to a textual @name when the target account is unknown', async () => {
    const requests: any[] = [];
    const bus = createRoomBus({
      registry: registryOf(),
      outbound: { send: async (request) => { requests.push(request); return { status: 'sent' as const }; } },
      requester: rootPluginId(),
      accountOf: () => undefined,
    });
    await bus.handoff(event());
    expect(requests[0].content).toBe('@res please research X');
  });

  it('notifies subscribers after the projection and supports unsubscribe', async () => {
    const { bus, requests } = setup();
    const order: string[] = [];
    const seen: RoomHandoffEvent[] = [];
    const off = bus.subscribe((e) => { order.push(`event:${requests.length}`); seen.push(e); });
    const result = await bus.handoff(event());
    expect(result).toEqual({ delivered: true, projected: true });
    expect(seen).toEqual([event()]);
    // projection (one request) happened before the subscriber ran
    expect(order).toEqual(['event:1']);
    off();
    expect((await bus.handoff(event({ id: 'h-2' }))).delivered).toBe(false);
  });

  it('reports a failed projection but still delivers the event', async () => {
    const { bus, warnings } = setup(async () => ({ status: 'failed', failure: { code: 'endpoint_offline' } }));
    const seen: string[] = [];
    bus.subscribe((e) => { seen.push(e.id); });
    const result = await bus.handoff(event());
    expect(result).toEqual({ delivered: true, projected: false, projectionError: 'endpoint_offline' });
    expect(seen).toEqual(['h-1']);
    expect(warnings.some((w) => w.includes('projection failed'))).toBe(true);
  });

  it('treats a throwing send as a projection failure, not a lost event', async () => {
    const { bus } = setup(async () => { throw new Error('boom'); });
    bus.subscribe(() => undefined);
    expect(await bus.handoff(event())).toEqual({ delivered: true, projected: false, projectionError: 'boom' });
  });

  it('isolates subscriber failures', async () => {
    const { bus, warnings } = setup();
    let ok = 0;
    bus.subscribe(() => { throw new Error('bad listener'); });
    bus.subscribe(() => { ok++; });
    const result = await bus.handoff(event());
    expect(result.delivered).toBe(true);
    expect(ok).toBe(1);
    expect(warnings.some((w) => w.includes('bad listener'))).toBe(true);
  });
});

describe('Room Bus on a real ImRuntime', () => {
  it('sends the projection through the normal send chain as the from-member Bot, and its echo is never a human turn', async () => {
    const f = await createRoomImFixture();
    try {
      const bus = createRoomBus({
        registry: f.registry,
        outbound: f.im,
        requester: rootPluginId(),
        accountOf: (id) => f.peerRegistry.selfOf(id),
      });
      const result = await bus.handoff(event());
      expect(result.projected).toBe(true);
      expect(f.sent).toHaveLength(1);
      expect(f.sent[0]!.conversation.endpoint.id).toBe(f.ids.a);
      expect(f.sent[0]!.conversation.id).toBe('room-1');

      // The platform echoes the projection back to every member Endpoint (message id out-1,
      // sender = the speaking Bot account). It is recorded, never routed as a human turn.
      await f.deliver(f.ids.a, { messageId: 'out-1', sender: ACCOUNT.a });
      await f.deliver(f.ids.b, { messageId: 'out-1', sender: ACCOUNT.a });
      await f.deliver(f.ids.c, { messageId: 'out-1', sender: ACCOUNT.a });
      expect(f.routed).toEqual([]);
    } finally { await f.close(); }
  });
});
