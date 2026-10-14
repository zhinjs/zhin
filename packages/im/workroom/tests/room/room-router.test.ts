import { routeRoomMessage } from '../../src/room/room-router.js';
import { roomDefinition, registryOf, facts, EP } from './room-fixtures.js';

const route = (f = facts(), def = roomDefinition()) => routeRoomMessage(registryOf(def).room('dev')!, f);
const noCoordinator = () => roomDefinition({ coordinator: undefined });

describe('routeRoomMessage', () => {
  it('prefers pending over mention over reply over coordinator', () => {
    const all = facts({
      pending: (id) => id === EP.wri,
      mentionTargets: ['acct-res'],
      replyToEndpointId: EP.lead,
    });
    expect(route(all)).toMatchObject({ endpointId: EP.wri, reason: 'pending' });
    expect(route({ ...all, pending: () => false })).toMatchObject({ endpointId: EP.res, reason: 'mention' });
    expect(route({ ...all, pending: () => false, mentionTargets: [], replyToEndpointId: EP.wri }))
      .toMatchObject({ endpointId: EP.wri, reason: 'reply' });
    expect(route(facts())).toMatchObject({ endpointId: EP.lead, reason: 'coordinator' });
  });

  it('takes the first member in declaration order when several have a pending answer', () => {
    expect(route(facts({ pending: (id) => id !== EP.lead }))).toMatchObject({ endpointId: EP.res, reason: 'pending' });
  });

  it('matches @alias in text case-insensitively with word boundaries', () => {
    expect(route(facts({ content: 'hey @REX look' }))).toMatchObject({ endpointId: EP.res, reason: 'mention' });
    expect(route(facts({ content: '@boss please' }))).toMatchObject({ endpointId: EP.lead, reason: 'mention' });
    expect(route(facts({ content: '@wri, go' }))).toMatchObject({ endpointId: EP.wri, reason: 'mention' });
    // `@re` is a prefix of an alias, `@rexx` extends one, and an email address is not a mention.
    for (const content of ['@re hi', '@rexx hi', 'mail me at x@rex.dev', 'rex without at']) {
      expect(route(facts({ content }))?.reason).toBe('coordinator');
    }
  });

  it('does not let a CJK name prefix match a longer CJK name', () => {
    const def = roomDefinition({
      members: [
        { agent: 'r1', role: 'writer', aliases: ['研究'], botEndpoint: { adapter: 'qq', endpoint: 'b1' } },
        { agent: 'r2', role: 'writer', aliases: ['研究员'], botEndpoint: { adapter: 'qq', endpoint: 'b2' } },
      ],
      coordinator: undefined,
    });
    expect(route(facts({ content: '@研究员 你好' }), def)).toMatchObject({ endpointId: 'ep-b2', reason: 'mention' });
    expect(route(facts({ content: '@研究 你好' }), def)).toMatchObject({ endpointId: 'ep-b1', reason: 'mention' });
    expect(route(facts({ content: '@研究，你好' }), def)).toMatchObject({ endpointId: 'ep-b1', reason: 'mention' });
    // Unspaced CJK has no delimiter after the alias, so it is not a text mention (use the platform segment).
    expect(route(facts({ content: '@研究员帮我看看' }), def)?.reason).toBe('role');
    expect(route(facts({ content: '请 @研究，谢谢' }), def)).toMatchObject({ endpointId: 'ep-b1', reason: 'mention' });
  });

  it('does not let a name prefix match a longer name', () => {
    const def = roomDefinition({
      members: [
        { agent: 'ab', role: 'writer', botEndpoint: { adapter: 'qq', endpoint: 'b1' } },
        { agent: 'abc', role: 'writer', botEndpoint: { adapter: 'qq', endpoint: 'b2' } },
      ],
      coordinator: undefined,
    });
    expect(route(facts({ content: '@abc hi' }), def)).toMatchObject({ endpointId: 'ep-b2', reason: 'mention' });
    expect(route(facts({ content: '@ab hi' }), def)).toMatchObject({ endpointId: 'ep-b1', reason: 'mention' });
  });

  it('takes the first mentioned member when several are mentioned', () => {
    expect(route(facts({ content: '@wri then @rex' }))).toMatchObject({ endpointId: EP.wri, reason: 'mention' });
    expect(route(facts({ content: '@rex then @wri' }))).toMatchObject({ endpointId: EP.res, reason: 'mention' });
    // structured mention targets keep message order and win over text mentions
    expect(route(facts({ mentionTargets: ['acct-wri', 'acct-res'], content: '@rex' })))
      .toMatchObject({ endpointId: EP.wri, reason: 'mention' });
  });

  it('does not hand a mention of a non-member account to the coordinator or role', () => {
    expect(route(facts({ mentionTargets: ['stranger'] }))).toBeUndefined();
    expect(route(facts({ mentionTargets: ['stranger'] }), noCoordinator())).toBeUndefined();
    expect(route(facts({ mentionTargets: ['stranger', 'acct-res'] })))
      .toMatchObject({ endpointId: EP.res, reason: 'mention' });
    expect(route(facts({ mentionTargets: ['stranger'], pending: (id) => id === EP.wri })))
      .toMatchObject({ endpointId: EP.wri, reason: 'pending' });
    expect(route(facts({ mentionTargets: ['stranger'], replyToEndpointId: EP.res })))
      .toMatchObject({ endpointId: EP.res, reason: 'reply' });
    expect(route(facts({ mentionTargets: ['stranger'], content: 'hey @rex' })))
      .toMatchObject({ endpointId: EP.res, reason: 'mention' });
    // a mentioned member that is unavailable still degrades to the coordinator
    expect(route(facts({ mentionTargets: ['acct-res'], isAvailable: (id) => id !== EP.res })))
      .toMatchObject({ endpointId: EP.lead, reason: 'coordinator' });
  });

  it('degrades to the next priority when the chosen member is unavailable', () => {
    const base = { mentionTargets: ['acct-res'], replyToEndpointId: EP.wri, pending: (id: string) => id === EP.wri };
    expect(route(facts({ ...base, isAvailable: (id) => id !== EP.wri }))).toMatchObject({ endpointId: EP.res, reason: 'mention' });
    expect(route(facts({ ...base, isAvailable: (id) => id === EP.lead }))).toMatchObject({ endpointId: EP.lead, reason: 'coordinator' });
    expect(route(facts({ ...base, isAvailable: (id) => id !== EP.lead && id !== EP.res }))).toMatchObject({ endpointId: EP.wri, reason: 'pending' });
    expect(route(facts({ ...base, isAvailable: () => false }))).toBeUndefined();
  });

  it('falls back to role matching when the coordinator is unavailable', () => {
    expect(route(facts({ isAvailable: (id) => id === EP.wri }))).toMatchObject({ endpointId: EP.wri, reason: 'role' });
  });

  describe('without a coordinator (role matching)', () => {
    it('prefers a generalist role (accepts undeclared)', () => {
      const def = roomDefinition({
        coordinator: undefined,
        roles: { specialist: { prompt: 'p', accepts: ['code'] }, any: { prompt: 'p' } },
        members: [
          { agent: 'a', role: 'specialist', botEndpoint: { adapter: 'qq', endpoint: 'b1' } },
          { agent: 'b', role: 'any', botEndpoint: { adapter: 'qq', endpoint: 'b2' } },
        ],
      });
      expect(route(facts(), def)).toMatchObject({ endpointId: 'ep-b2', reason: 'role' });
    });

    it('then a role accepting chat or general', () => {
      const def = roomDefinition({
        coordinator: undefined,
        roles: { s: { prompt: 'p', accepts: ['code'] }, g: { prompt: 'p', accepts: ['general'] }, c: { prompt: 'p', accepts: ['chat'] } },
        members: [
          { agent: 'a', role: 's', botEndpoint: { adapter: 'qq', endpoint: 'b1' } },
          { agent: 'b', role: 'g', botEndpoint: { adapter: 'qq', endpoint: 'b2' } },
          { agent: 'c', role: 'c', botEndpoint: { adapter: 'qq', endpoint: 'b3' } },
        ],
      });
      expect(route(facts(), def)).toMatchObject({ endpointId: 'ep-b2', reason: 'role' });
      expect(route(facts({ isAvailable: (id) => id !== 'ep-b2' }), def)).toMatchObject({ endpointId: 'ep-b3', reason: 'role' });
    });

    it('then the first available member', () => {
      expect(route(facts(), noCoordinator())).toMatchObject({ endpointId: EP.lead, reason: 'role' });
      expect(route(facts({ isAvailable: (id) => id === EP.wri }), noCoordinator())).toMatchObject({ endpointId: EP.wri, reason: 'role' });
    });
  });

  it('lists the other available members as fallbacks, generalist then chat then declaration order', () => {
    const def = roomDefinition({
      coordinator: undefined,
      roles: {
        s: { prompt: 'p', accepts: ['code'] },
        g: { prompt: 'p', accepts: ['general'] },
        any: { prompt: 'p' },
        s2: { prompt: 'p', accepts: ['math'] },
      },
      members: [
        { agent: 'a', role: 's', botEndpoint: { adapter: 'qq', endpoint: 'b1' } },
        { agent: 'b', role: 'g', botEndpoint: { adapter: 'qq', endpoint: 'b2' } },
        { agent: 'c', role: 'any', botEndpoint: { adapter: 'qq', endpoint: 'b3' } },
        { agent: 'd', role: 's2', botEndpoint: { adapter: 'qq', endpoint: 'b4' } },
      ],
    });
    expect(route(facts(), def)).toEqual({
      endpointId: 'ep-b3', reason: 'role', fallbackEndpointIds: ['ep-b2', 'ep-b1', 'ep-b4'],
    });
    // The target is never in its own fallbacks; unavailable members are skipped.
    const withLead = route(facts({ isAvailable: (id) => id !== EP.wri }));
    expect(withLead).toEqual({ endpointId: EP.lead, reason: 'coordinator', fallbackEndpointIds: [EP.res] });
  });

  it('does not depend on which Endpoint received the copy or its mentioned flag', () => {
    const extra = { conversation: { endpoint: { id: EP.wri } }, mentioned: true } as object;
    const a = route(facts({ mentionTargets: ['acct-res'], ...extra }));
    const b = route(facts({ mentionTargets: ['acct-res'] }));
    expect(a).toEqual(b);
  });
});
