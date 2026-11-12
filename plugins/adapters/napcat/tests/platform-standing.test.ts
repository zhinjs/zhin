import { describe, expect, it } from 'vitest';
import { resolveTurnCapabilities } from 'zhin.js/adapter';
import napcat from '../adapters/napcat/index.js';
import { napcatSenderStanding, type NapCatEvent } from '../src/protocol.js';

const event = (extra: Partial<NapCatEvent>): NapCatEvent => ({ post_type: 'message', message_type: 'group', user_id: 1, ...extra } as NapCatEvent);

describe('NapCat sender.platform (ADR 0056 §1)', () => {
  it('maps the group sender role to the normalized standing', () => {
    expect(napcatSenderStanding(event({ sender: { role: 'owner' } }))).toEqual({ standing: 'owner' });
    expect(napcatSenderStanding(event({ sender: { role: 'admin' } }))).toEqual({ standing: 'admin' });
    expect(napcatSenderStanding(event({ sender: { role: 'member' } }))).toEqual({ standing: 'member' });
  });

  it('reports nothing for private chats or unknown roles', () => {
    expect(napcatSenderStanding(event({ message_type: 'private', sender: { role: 'owner' } }))).toBeUndefined();
    expect(napcatSenderStanding(event({ sender: { role: 'boss' } }))).toBeUndefined();
    expect(napcatSenderStanding(event({}))).toBeUndefined();
  });

  it('declares standing (only) for group conversations in the capability profile', () => {
    const conversation = (kind: 'group' | 'private') => ({ endpoint: { id: 'e', adapter: 'napcat' }, kind, id: '1' });
    const group = resolveTurnCapabilities({ profile: napcat.profile!, conversation: conversation('group') });
    expect(group.get('scene.platformStanding')).toEqual({ standing: true });
    expect(resolveTurnCapabilities({ profile: napcat.profile!, conversation: conversation('private') }).has('scene.platformStanding')).toBe(false);
  });
});
