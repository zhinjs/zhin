import type { DeliveryTarget } from 'zhin.js';
import { resolveGroupSuiteConfig } from '../src/config.js';
import { normalizeWelcomeConversations, welcomeConversationAllowed } from '../src/welcome-scope.js';

const root: DeliveryTarget = { endpoint: { adapter: 'icqq', id: 'root/qq\0zhin.adapter\0icqq~main' }, kind: 'group', id: 'g1' };
const nested: DeliveryTarget = { ...root, parent: { kind: 'channel', id: 'parent' }, threadId: 'thread' };

describe('exact welcome conversations', () => {
  it('preserves omitted scope, distinguishes [] and never mutates caller addresses', () => {
    expect(resolveGroupSuiteConfig({})).not.toHaveProperty('welcomeConversations');
    expect(welcomeConversationAllowed(undefined, nested)).toBe(true);
    expect(welcomeConversationAllowed([], root)).toBe(false);
    const input = [{ ...nested, endpoint: { ...nested.endpoint } }];
    const scopes = normalizeWelcomeConversations(input);
    expect(scopes).toEqual(input); expect(Object.isFrozen(scopes[0]?.endpoint)).toBe(true);
    input[0]!.endpoint = { adapter: 'other', id: 'changed' };
    expect(welcomeConversationAllowed(scopes, nested)).toBe(true);
  });

  it.each<DeliveryTarget>([
    { ...nested, endpoint: { ...nested.endpoint, id: `${nested.endpoint.id}-other` } },
    { ...nested, endpoint: { ...nested.endpoint, adapter: 'other' } },
    { ...nested, kind: 'channel' }, { ...nested, id: 'other' },
    { ...nested, parent: { kind: 'group', id: 'parent' } },
    { ...nested, parent: { kind: 'channel', id: 'other' } },
    { ...root, threadId: 'thread' }, { ...root, parent: nested.parent },
    { ...nested, threadId: 'other' }, root,
  ])('does not match a different full identity: %j', target => {
    expect(welcomeConversationAllowed([nested], target)).toBe(false);
  });

  it('matches absent fields only with absence and accepts an exact duplicate list', () => {
    expect(welcomeConversationAllowed([root], root)).toBe(true);
    expect(welcomeConversationAllowed([root], nested)).toBe(false);
    expect(welcomeConversationAllowed([nested, nested], nested)).toBe(true);
    expect(welcomeConversationAllowed([root, nested], nested)).toBe(true);
    expect(welcomeConversationAllowed([{ ...root, id: '*' }], root)).toBe(false);
    expect(welcomeConversationAllowed([{ ...root, threadId: '*' }], { ...root, threadId: 'topic' })).toBe(false);
  });

  it.each<unknown>([
    null, {}, 'g1', Array.from({ length: 101 }, () => root),
    [{ ...root, kind: 'private' }], [{ ...root, kind: 'channel' }],
    [{ ...root, id: '' }], [{ ...root, endpoint: { adapter: '', id: 'x' } }],
    [{ ...root, endpoint: { adapter: 'icqq', id: '' } }],
    [{ ...root, parent: null }], [{ ...root, parent: { kind: 'group' } }],
    [{ ...root, threadId: null }], [{ ...root, threadId: '' }],
  ])('refuses invalid startup addresses: %j', value => {
    expect(() => normalizeWelcomeConversations(value)).toThrow();
  });
});
