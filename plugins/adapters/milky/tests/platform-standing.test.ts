import { describe, expect, it } from 'vitest';
import { resolveTurnCapabilities } from 'zhin.js/adapter';
import milky from '../adapters/milky/index.js';
import { milkySenderStanding, type MilkyIncomingMessage } from '../src/protocol.js';

const message = (extra: Partial<MilkyIncomingMessage>): MilkyIncomingMessage => ({
  message_scene: 'group', peer_id: 1, message_seq: 1, sender_id: 2, time: 0, segments: [], ...extra,
});

describe('Milky sender.platform (ADR 0056 §1)', () => {
  it('maps group_member.role to the normalized standing', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect(milkySenderStanding(message({ group_member: { user_id: 2, role } }))).toEqual({ standing: role });
    }
  });

  it('reports nothing outside groups or for unknown roles', () => {
    expect(milkySenderStanding(message({ message_scene: 'friend', group_member: { user_id: 2, role: 'owner' } }))).toBeUndefined();
    expect(milkySenderStanding(message({ group_member: { user_id: 2, role: 'boss' } }))).toBeUndefined();
    expect(milkySenderStanding(message({}))).toBeUndefined();
  });

  it('declares standing for group conversations', () => {
    const conversation = (kind: 'group' | 'private') => ({ endpoint: { id: 'e', adapter: 'milky' }, kind, id: '1' });
    expect(resolveTurnCapabilities({ profile: milky.profile!, conversation: conversation('group') }).get('scene.platformStanding')).toEqual({ standing: true });
    expect(resolveTurnCapabilities({ profile: milky.profile!, conversation: conversation('private') }).has('scene.platformStanding')).toBe(false);
  });
});
