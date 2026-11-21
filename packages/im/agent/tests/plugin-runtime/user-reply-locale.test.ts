import { rootPluginId, userLocalePreferencesToken, type RuntimeSnapshot, type UserLocalePreferences } from '@zhin.js/plugin-runtime';
import type { Message } from '@zhin.js/core';
import { readUserSetReplyLocale } from '../../src/plugin-runtime/ingress/user-reply-locale.js';

const endpoint = { adapter: 'qq', id: 'root\u0000zhin.adapter\u0000bot' };
function snapshot(preferences?: UserLocalePreferences): RuntimeSnapshot {
  const resources = preferences ? new Map([[rootPluginId(), new Map<string, unknown>([[userLocalePreferencesToken.id, preferences]])]]) : new Map();
  return { root: rootPluginId(), resources } as unknown as RuntimeSnapshot;
}
function message(senderId: string | undefined, locale: 'en' | 'zh-CN'): Message {
  return { conversation: { endpoint, kind: 'group', id: 'g1' }, sender: senderId ? { id: senderId } : undefined, locale } as unknown as Message;
}

describe('readUserSetReplyLocale (#1250 b69)', () => {
  const stored: Record<string, 'en' | 'zh-CN'> = { alice: 'en' };
  const preferences: UserLocalePreferences = {
    get: vi.fn(async (target, senderId) => (target.id === endpoint.id ? stored[senderId] : undefined)),
    set: async () => {},
  };

  it('returns each group member\'s own setting and nothing for members who never set one', async () => {
    expect(await readUserSetReplyLocale(snapshot(preferences), message('alice', 'en'))).toBe('en');
    expect(await readUserSetReplyLocale(snapshot(preferences), message('bob', 'zh-CN'))).toBeUndefined();
    expect(preferences.get).toHaveBeenCalledWith(endpoint, 'alice');
  });

  it('treats a changed, failed or missing preference as not set by the user', async () => {
    expect(await readUserSetReplyLocale(snapshot(preferences), message('alice', 'zh-CN'))).toBeUndefined();
    expect(await readUserSetReplyLocale(snapshot({ get: async () => { throw new Error('db down'); }, set: async () => {} }), message('alice', 'en'))).toBeUndefined();
    expect(await readUserSetReplyLocale(snapshot(), message('alice', 'en'))).toBeUndefined();
    expect(await readUserSetReplyLocale(snapshot(preferences), message(undefined, 'en'))).toBeUndefined();
  });
});
