import { describe, expect, it } from 'vitest';
import { channelKey, gamePlayerFromInput, gameTargetFromKey } from '../src/index.js';

const conversation = { endpoint: { id: 'root/test\0zhin.adapter\0slot~old', adapter: 'synthetic' },
  kind: 'group' as const, id: 'room-1' };

describe('game player capture', () => {
  it('copies canonical address and real sender without retaining live message methods', () => {
    const source = { conversation, endpointId: 'display-alias', metadata: { endpoint: 'wrong-alias', senderId: 'fake' },
      sender: { id: 'alice', name: 'Alice' }, $client: {} };
    const alice = gamePlayerFromInput(source), bob = gamePlayerFromInput({ conversation, sender: { id: 'bob' } });
    expect(alice.sender).toEqual({ id: 'alice', name: 'Alice' });
    expect(bob.sender).toEqual({ id: 'bob' });
    expect(alice.target).toEqual(conversation);
    expect(alice).not.toHaveProperty('$client');
    expect(Object.isFrozen(alice.target)).toBe(true);
    expect(channelKey(alice)).toBe(channelKey(bob));
    expect(gameTargetFromKey(channelKey(alice))).toEqual(conversation);
  });

  it('isolates replacements, parents and threads while the same account remains stable', () => {
    const scope = (changes: Partial<typeof conversation> & { threadId?: string; parent?: { kind: 'group'; id: string } }) =>
      channelKey(gamePlayerFromInput({ conversation: { ...conversation, ...changes }, sender: { id: 'alice' } }));
    expect(scope({})).toBe(scope({}));
    expect(scope({ endpoint: { ...conversation.endpoint, id: 'new-account' } })).not.toBe(scope({}));
    expect(scope({ threadId: 'first' })).not.toBe(scope({ threadId: 'second' }));
    expect(scope({ parent: { kind: 'group', id: 'first' } })).not.toBe(scope({ parent: { kind: 'group', id: 'second' } }));
    expect(gameTargetFromKey('synthetic-default-group:room')).toBeUndefined();
  });

  it.each([undefined, {}, { conversation }, { conversation, sender: 'alice' },
    { conversation, metadata: { senderId: 'alice' } }])('refuses missing or fabricated actors: %j', input => {
    expect(() => gamePlayerFromInput(input)).toThrow(/require/);
  });

  it('preserves per-operation locale and command presentation', () => {
    expect(gamePlayerFromInput({ conversation, sender: { id: 'alice' }, locale: 'en' }).locale).toBe('en');
    expect(gamePlayerFromInput({ conversation, sender: { id: 'bob' }, locale: 'zh-CN' }).locale).toBe('zh-CN');
  });
});
