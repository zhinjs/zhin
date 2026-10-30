import { rootPluginId } from '@zhin.js/plugin-runtime';
import { projectUserInteraction, renderUserInteraction } from '../../../core/src/built/user-interaction.js';
import { createRoomMembershipPort } from '../../src/room/room-membership.js';
import { roomDefinition, registryOf, facts, EP } from './room-fixtures.js';
import { createRoomImFixture, ACCOUNT } from './room-im-fixture.js';

const conv = (over: Record<string, unknown> = {}) => ({
  endpoint: { id: 'ep-b1', adapter: 'qq' }, kind: 'group', id: '100', ...over,
}) as never;

describe('createRoomMembershipPort', () => {
  it('always provides hasRoom together with route (B2-1 ships-together invariant)', () => {
    const port = createRoomMembershipPort(registryOf());
    expect(typeof port.hasRoom).toBe('function');
    expect(typeof port.route).toBe('function');
    expect(typeof port.isMember).toBe('function');
    expect(Object.isFrozen(port)).toBe(true);
  });

  it('hasRoom follows the registry', () => {
    const port = createRoomMembershipPort(registryOf());
    expect(port.hasRoom!(conv())).toBe(true);
    expect(port.hasRoom!(conv({ id: 'other' }))).toBe(false);
  });

  it('hasRoom and route are decided by the receiving Endpoint: a non-member Endpoint in the same group is not in the Room', () => {
    const port = createRoomMembershipPort(registryOf());
    expect(port.hasRoom!(conv({ endpoint: { id: EP.res, adapter: 'qq' } }))).toBe(true);
    const outsider = conv({ endpoint: { id: 'ep-outsider', adapter: 'qq' } });
    expect(port.hasRoom!(outsider)).toBe(false);
    expect(port.route!({ conversation: outsider, senderId: 'alice', ...facts() } as never)).toBeUndefined();
  });

  it('isMember checks the peer endpoints against the conversation Room members', () => {
    const port = createRoomMembershipPort(registryOf());
    const peer = (...endpointIds: string[]) => ({ adapter: 'qq', userId: 'u', endpointIds: endpointIds as never });
    expect(port.isMember(peer(EP.res), conv())).toBe(true);
    expect(port.isMember(peer('ep-outside', EP.wri), conv())).toBe(true);
    expect(port.isMember(peer('ep-outside'), conv())).toBe(false);
    expect(port.isMember(peer(EP.res), conv({ id: 'not-a-room' }))).toBe(false);
  });

  it('route delegates to the pure router and returns undefined outside a Room', () => {
    const port = createRoomMembershipPort(registryOf());
    const input = (conversation: unknown, over = {}) => ({ conversation, senderId: 'alice', ...facts(over) }) as never;
    expect(port.route!(input(conv(), { mentionTargets: ['acct-res'] }))).toMatchObject({ endpointId: EP.res, reason: 'mention' });
    expect(port.route!(input(conv({ id: 'other' })))).toBeUndefined();
    expect(roomDefinition().coordinator).toBe('lead');
  });
});

describe('Room membership port on a real ImRuntime (3 Endpoints)', () => {
  it('routes an @ on a later Endpoint to that member, once, with mentioned forced', async () => {
    const f = await createRoomImFixture();
    try {
      const mention = { segments: [{ type: 'mention', data: { target: ACCOUNT.b } }] };
      const id = 'at-1';
      await Promise.all([
        f.deliver(f.ids.a, { messageId: id, mentioned: false, ...mention }),
        f.deliver(f.ids.c, { messageId: id, mentioned: false, ...mention }),
        f.deliver(f.ids.b, { messageId: id, mentioned: true, ...mention }),
      ]);
      expect(f.routed).toEqual([{ endpointId: f.ids.b, mentioned: true, content: 'plain chat', origin: 'human' }]);
    } finally { await f.close(); }
  });

  it('routes a plain message to the coordinator even when only another Endpoint saw it first', async () => {
    const f = await createRoomImFixture();
    try {
      await f.deliverAll([f.ids.c, f.ids.a], { messageId: 'plain-1', mentioned: false });
      expect(f.routed.map((r) => [r.endpointId, r.mentioned])).toEqual([[f.ids.a, true]]);
    } finally { await f.close(); }
  });

  it('routes @alias text to the member without a structured mention', async () => {
    const f = await createRoomImFixture();
    try {
      await f.deliverAll([f.ids.a, f.ids.b], { messageId: 'txt-1', content: 'hey @RES can you check' });
      expect(f.routed.map((r) => r.endpointId)).toEqual([f.ids.b]);
    } finally { await f.close(); }
  });

  it('routes a reply to a member Bot message back to that Bot', async () => {
    const f = await createRoomImFixture();
    try {
      // c speaks in the group; the ledger remembers who sent out-1.
      await f.im.send({ conversation: f.conversation(f.ids.c), requester: rootPluginId(), content: 'finding: x' });
      await f.deliverAll([f.ids.a, f.ids.c], { messageId: 'rep-1', replyTo: { id: 'out-1' } });
      expect(f.routed.map((r) => [r.endpointId, r.mentioned])).toEqual([[f.ids.c, true]]);
    } finally { await f.close(); }
  });

  it.each(['winner-first', 'loser-first'] as const)(
    'consumes a pending interaction on a non-coordinator Endpoint exactly once (%s)',
    async (order) => {
      const answers: string[] = [];
      const f = await createRoomImFixture({
        async onRoute(message, im) {
          // Start the question from a real, leased inbound Message so its
          // generation, owner and retirement signal come from the Runtime.
          answers.push(await im.createInteraction(message)!.ask({ type: 'text', title: 'Name', timeout: 5000 }));
        },
      });
      const starting = f.deliver(f.ids.c, {
        messageId: 'ask-start', content: 'ask my name',
        segments: [{ type: 'mention', data: { target: ACCOUNT.c } }],
      });
      try {
        await vi.waitFor(() => expect(f.sent).toHaveLength(1));
        expect(f.sent[0]!.conversation).toEqual(f.conversation(f.ids.c));
        expect(answers).toEqual([]);
        const copies = [f.ids.a, f.ids.b, f.ids.c];
        if (order === 'winner-first') copies.reverse();
        await f.deliverAll(copies, { messageId: 'ask-1', content: 'my answer' });
        await starting;
        expect(answers).toEqual(['my answer']);
        expect(f.routed).toEqual([{ endpointId: f.ids.c, mentioned: true, content: 'ask my name', origin: 'human' }]);
      } finally {
        try { await starting; } finally { await f.close(); }
      }
    },
  );

  it('a live keyboard on Bot A does not capture human messages meant for B; only a button answer does', async () => {
    const f = await createRoomImFixture();
    try {
      const sentKeyboard = await f.im.send({
        conversation: f.conversation(f.ids.a) as never,
        requester: rootPluginId(),
        content: renderUserInteraction(projectUserInteraction({ type: 'confirm', title: 'Go?' } as never)) as never,
      } as never);
      expect(sentKeyboard.status).toBe('sent');
      const mention = { segments: [{ type: 'mention', data: { target: ACCOUNT.b } }] };
      await Promise.all([
        f.deliver(f.ids.a, { messageId: 'kb-1', content: 'look at this', mentioned: false, ...mention }),
        f.deliver(f.ids.b, { messageId: 'kb-1', content: 'look at this', mentioned: true, ...mention }),
      ]);
      expect(f.routed.map((r) => r.endpointId)).toEqual([f.ids.b]);
      // Unrelated plain text still goes to the coordinator (A), which here is also the keyboard owner.
      await f.deliverAll([f.ids.c, f.ids.a], { messageId: 'kb-2', content: 'unrelated', mentioned: false });
      expect(f.routed.map((r) => r.endpointId)).toEqual([f.ids.b, f.ids.a]);
      // A text that resolves to the keyboard button is the pending answer and goes to its owner.
      await f.deliverAll([f.ids.b, f.ids.a], { messageId: 'kb-3', content: '1', mentioned: true, ...mention });
      expect(f.routed.map((r) => r.endpointId)).toEqual([f.ids.b, f.ids.a, f.ids.a]);
    } finally { await f.close(); }
  });

  it('does not trigger turns for member or peer-bot messages', async () => {
    const f = await createRoomImFixture();
    try {
      await f.deliver(f.ids.a, { messageId: 'bot-1', sender: ACCOUNT.b });
      await f.deliver(f.ids.b, { messageId: 'bot-1', sender: ACCOUNT.b });
      expect(f.routed).toEqual([]);
    } finally { await f.close(); }
  });

  it('leaves conversations outside any Room untouched', async () => {
    const f = await createRoomImFixture();
    try {
      const conv = { endpoint: { id: f.ids.b, adapter: 'memory' }, kind: 'group' as const, id: 'other-group' };
      await f.deliver(f.ids.b, { messageId: 'o-1', content: 'hi', conversation: conv });
      expect(f.routed.map((r) => r.endpointId)).toEqual([f.ids.b]);
    } finally { await f.close(); }
  });
});
