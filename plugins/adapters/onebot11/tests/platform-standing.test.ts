import { describe, expect, it } from 'vitest';
import { resolveTurnCapabilities } from 'zhin.js/adapter';
import onebot11 from '../adapters/onebot11/index.js';
import { onebot11SenderStanding, type OneBot11Event } from '../src/protocol.js';

const event = (extra: Partial<OneBot11Event>): OneBot11Event => ({ post_type: 'message', message_type: 'group', user_id: 1, ...extra } as OneBot11Event);

describe('OneBot11 sender.platform (ADR 0056 §1)', () => {
  it('maps the group sender role to the normalized standing', () => {
    expect(onebot11SenderStanding(event({ sender: { role: 'owner' } }))).toEqual({ standing: 'owner' });
    expect(onebot11SenderStanding(event({ sender: { role: 'admin' } }))).toEqual({ standing: 'admin' });
    expect(onebot11SenderStanding(event({ sender: { role: 'member' } }))).toEqual({ standing: 'member' });
  });

  it('reports nothing for private chats or unknown roles', () => {
    expect(onebot11SenderStanding(event({ message_type: 'private', sender: { role: 'owner' } }))).toBeUndefined();
    expect(onebot11SenderStanding(event({ sender: { role: 'boss' } }))).toBeUndefined();
    expect(onebot11SenderStanding(event({}))).toBeUndefined();
  });

  it('declares standing (only) for group conversations in the capability profile', () => {
    const conversation = (kind: 'group' | 'private') => ({ endpoint: { id: 'e', adapter: 'onebot11' }, kind, id: '1' });
    const group = resolveTurnCapabilities({ profile: onebot11.profile!, conversation: conversation('group') });
    expect(group.get('scene.platformStanding')).toEqual({ standing: true });
    expect(resolveTurnCapabilities({ profile: onebot11.profile!, conversation: conversation('private') }).has('scene.platformStanding')).toBe(false);
  });
});
