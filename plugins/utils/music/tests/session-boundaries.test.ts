import { describe, expect, it, vi } from 'vitest';
import type { ConversationRef } from '@zhin.js/im-contract';
import type { Locale } from 'zhin.js/i18n';
import searchCommand from '../commands/点歌/[keyword]/index.js';
import loginCommand from '../commands/login/[platform]/index.js';
import selectionMiddleware from '../middlewares/music-selection/index.js';
import { MusicSearchSessions, sessionKey } from '../src/session.js';
import { QrLoginRuntime, loginSessionKey, type QrLoginProvider } from '../src/login/index.js';
import { CredentialStore, createInMemoryCredentialDb } from '../src/credential-store.js';

const original: ConversationRef = { endpoint: { adapter: 'platform', id: 'bot' }, kind: 'channel', id: 'same-id',
  parent: { kind: 'channel', id: 'parent' }, threadId: 'thread' };
const boundaries: Array<[string, ConversationRef]> = [
  ['endpoint', { ...original, endpoint: { ...original.endpoint, id: 'other-bot' } }],
  ['adapter', { ...original, endpoint: { ...original.endpoint, adapter: 'other-platform' } }],
  ['conversation kind', { ...original, kind: 'group' }],
  ['parent id', { ...original, parent: { kind: 'channel', id: 'other-parent' } }],
  ['parent kind', { ...original, parent: { kind: 'group', id: 'parent' } }],
  ['thread', { ...original, threadId: 'other-thread' }],
  ['unthreaded conversation', { ...original, threadId: undefined }],
];
function input(conversation: ConversationRef, content: string, locale: Locale = 'en', sender = 'same-sender') {
  return { conversation, content, locale, sender: { id: sender }, metadata: { endpointId: 'untrusted-shared-endpoint' }, $reply: vi.fn(async () => {}) };
}
function context(runtime: unknown, message: ReturnType<typeof input>, params: Record<string, string>, locale: Locale = message.locale) {
  return { use: () => runtime, input: message, params, locale, config: {}, formatCommand: (path: string) => `!!music ${path}` };
}

describe('Music flow identity at command and middleware boundaries', () => {
  it.each(boundaries)('isolates search selection and cancellation by %s, with language pinned to each flow', async (_name, other) => {
    const sessions = new MusicSearchSessions();
    const service = {
      search: vi.fn(async (keyword: string) => [{ id: keyword, title: keyword, source: 'qq', url: '' }]),
      getDetail: vi.fn(async (id: string) => ({ id, title: id, source: 'qq', url: 'https://example.invalid/track' })),
    };
    const runtime = { sessions, services: { qq: service } };
    const first = input(original, 'music search first', 'en');
    expect(await searchCommand.execute(context(runtime, first, { keyword: 'first' }) as never)).toContain('"cancel"');
    const firstKey = sessionKey(original, 'same-sender');
    const secondKey = sessionKey(other, 'same-sender');
    for (const content of ['1', 'cancel']) {
      const stranger = input(other, content);
      const next = vi.fn();
      await selectionMiddleware.handle(context(runtime, stranger, {}) as never, next);
      expect(next).toHaveBeenCalledOnce();
      expect(stranger.$reply).not.toHaveBeenCalled();
      expect(service.getDetail).not.toHaveBeenCalled();
      expect(sessions.get(firstKey)?.locale).toBe('en');
    }
    const second = input(other, '点歌 second', 'zh-CN');
    await searchCommand.execute(context(runtime, second, { keyword: 'second' }) as never);
    expect(sessions.get(firstKey)?.keyword).toBe('first');
    expect(sessions.get(secondKey)?.keyword).toBe('second');
    const wrongLanguage = input(original, '取消', 'zh-CN');
    const next = vi.fn();
    await selectionMiddleware.handle(context(runtime, wrongLanguage, {}) as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(sessions.get(firstKey)).toBeDefined();
    const cancel = input(original, 'cancel', 'zh-CN');
    cancel.metadata.endpointId = 'different-metadata-does-not-change-identity';
    await selectionMiddleware.handle(context(runtime, cancel, {}) as never, vi.fn());
    expect(cancel.$reply).toHaveBeenCalledWith('Music selection cancelled.');
    expect(sessions.get(firstKey)).toBeUndefined();
    expect(sessions.get(secondKey)?.locale).toBe('zh-CN');
    const select = input(other, '1', 'en');
    await selectionMiddleware.handle(context(runtime, select, {}) as never, vi.fn());
    expect(service.getDetail).toHaveBeenCalledExactlyOnceWith('second');
    expect(select.$reply).toHaveBeenCalledWith(expect.objectContaining({ type: 'share', data: expect.objectContaining({ title: 'second' }) }));
    expect(sessions.get(secondKey)).toBeUndefined();
  });

  it('keeps another sender out of an active selection in the same exact conversation', async () => {
    const runtime = { sessions: new MusicSearchSessions(), services: { qq: { search: async () => [{ id: 'one', source: 'qq', title: 'one', url: '' }] } } };
    await searchCommand.execute(context(runtime, input(original, '', 'en'), { keyword: 'one' }) as never);
    const stranger = input(original, 'cancel', 'en', 'other-sender');
    const next = vi.fn();
    await selectionMiddleware.handle(context(runtime, stranger, {}) as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(runtime.sessions.get(sessionKey(original, 'same-sender'))).toBeDefined();
    expect(stranger.$reply).not.toHaveBeenCalled();
  });

  it.each(boundaries)('isolates QR login and cancellation by %s, while preserving each login language', async (_name, other) => {
    const credentials = new CredentialStore(createInMemoryCredentialDb());
    const waits: Array<() => void> = [];
    const provider: QrLoginProvider = {
      createQr: vi.fn(async () => ({ imageSegment: { type: 'image', data: {} }, pollData: {} })),
      pollQr: vi.fn(async () => ({ status: 'waiting', message: 'waiting' })),
    };
    const logins = new QrLoginRuntime(credentials, { qq: provider, netease: provider }, Date.now,
      () => new Promise<void>(resolve => { waits.push(resolve); }));
    const runtime = { logins };
    const first = input(original, '', 'en');
    const firstRunning = loginCommand.execute(context(runtime, first, { platform: 'qq' }) as never);
    const running = [firstRunning];
    await vi.waitFor(() => expect(waits).toHaveLength(1));
    const firstKey = loginSessionKey(original, 'same-sender');
    const secondKey = loginSessionKey(other, 'same-sender');
    try {
      expect(await loginCommand.execute(context(runtime, input(other, '', 'en'), { platform: 'cancel' }) as never)).toBe('There is no active login session.');
      expect(logins.get(firstKey)?.locale).toBe('en');
      expect(logins.get(secondKey)).toBeUndefined();
      const second = input(other, '', 'zh-CN');
      const secondRunning = loginCommand.execute(context(runtime, second, { platform: 'qq' }) as never);
      running.push(secondRunning);
      await vi.waitFor(() => expect(waits).toHaveLength(2));
      expect(provider.createQr).toHaveBeenCalledTimes(2);
      expect(logins.get(firstKey)?.locale).toBe('en');
      expect(logins.get(secondKey)?.locale).toBe('zh-CN');
      expect(await loginCommand.execute(context(runtime, input(original, '', 'zh-CN'), { platform: 'qq' }) as never)).toContain('login is in progress');
      expect(await loginCommand.execute(context(runtime, input(original, '', 'zh-CN'), { platform: '取消' }) as never)).toContain('Unsupported platform');
      const cancelFirst = input(original, '', 'zh-CN');
      cancelFirst.metadata.endpointId = 'different-metadata';
      expect(await loginCommand.execute(context(runtime, cancelFirst, { platform: 'cancel' }) as never)).toBe('Login cancelled.');
      expect(logins.get(firstKey)).toBeUndefined();
      expect(logins.get(secondKey)?.locale).toBe('zh-CN');
      waits[0]!();
      expect(await firstRunning).toContain('cancelled');
      expect(await loginCommand.execute(context(runtime, input(other, '', 'en'), { platform: '取消' }) as never)).toBe('已取消登录');
      waits[1]!();
      expect(await secondRunning).toContain('取消');
      expect(logins.get(secondKey)).toBeUndefined();
      expect(await credentials.list()).toEqual([]);
    } finally { logins.dispose(); for (const resolve of waits) resolve(); await Promise.all(running); }
  });
});
