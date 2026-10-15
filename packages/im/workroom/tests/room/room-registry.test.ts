import { createRoomRegistry } from '../../src/room/room-registry.js';
import { roomDefinition, endpointOf, registryOf, ACCOUNTS, EP } from './room-fixtures.js';

const conv = (over: Record<string, unknown> = {}) => ({
  endpoint: { id: 'ep-b1', adapter: 'qq' }, kind: 'group', id: '100', ...over,
}) as never;

describe('createRoomRegistry', () => {
  it('indexes the conversation without the endpoint, and members by endpoint', () => {
    const registry = registryOf();
    const room = registry.roomOf(conv())!;
    expect(room.id).toBe('dev');
    // Any member Bot's copy of the conversation resolves to the same Room.
    expect(registry.roomOf(conv({ endpoint: { id: 'ep-other', adapter: 'qq' } }))).toBe(room);
    expect(registry.roomOf(conv({ id: '999' }))).toBeUndefined();
    expect(registry.roomOf(conv({ kind: 'channel' }))).toBeUndefined();
    expect(registry.roomOf(conv({ endpoint: { id: 'ep-b1', adapter: 'discord' } }))).toBeUndefined();
    expect(registry.memberByEndpoint('dev', EP.res)?.agent).toBe('res');
    expect(registry.memberByEndpoint('dev', 'ep-none')).toBeUndefined();
    expect(registry.memberByEndpoint('nope', EP.res)).toBeUndefined();
    expect(room.coordinator?.agent).toBe('lead');
    expect(room.members.map((m) => m.endpointId)).toEqual([EP.lead, EP.res, EP.wri]);
  });

  it('ignores disabled Rooms', () => {
    const registry = createRoomRegistry({ dev: roomDefinition({ enabled: false }) }, endpointOf);
    expect(registry.roomOf(conv())).toBeUndefined();
    expect(registry.room('dev')).toBeUndefined();
    expect(registry.rooms()).toEqual([]);
  });

  it('resolves agent names and aliases case-insensitively', () => {
    const room = registryOf().room('dev')!;
    expect(room.memberByAlias('LEAD')?.agent).toBe('lead');
    expect(room.memberByAlias('Boss')?.agent).toBe('lead');
    expect(room.memberByAlias('REX')?.agent).toBe('res');
    expect(room.memberByAlias('nobody')).toBeUndefined();
    expect(room.memberByAgent('res')?.agent).toBe('res');
    expect(room.memberByAgent('RES')).toBeUndefined();
  });

  it('attributes a thread message to the Room of the parent conversation', () => {
    const registry = registryOf();
    expect(registry.roomOf(conv({ threadId: 't-1' }))).toBe(registry.roomOf(conv()));
  });

  it('finds a member by Bot account', () => {
    const registry = registryOf();
    const accountOf = (id: string) => ACCOUNTS[id];
    expect(registry.memberByAccount('dev', 'acct-res', accountOf)?.agent).toBe('res');
    expect(registry.memberByAccount('dev', 'stranger', accountOf)).toBeUndefined();
  });

  it('fails fast on a member that references an unknown role', () => {
    const bad = roomDefinition({ members: [{ agent: 'x', role: 'ghost', botEndpoint: { adapter: 'qq', endpoint: 'b9' } }] });
    expect(() => createRoomRegistry({ dev: bad }, endpointOf)).toThrow('unknown role ghost');
  });
});
