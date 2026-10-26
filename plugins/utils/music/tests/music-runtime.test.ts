import { describe, expect, it, vi } from 'vitest';
import { parseComponentDefinition } from 'zhin.js/component';
import { parseCommandDefinition } from 'zhin.js/command';
import { parseAgentToolDefinition } from '@zhin.js/tool';
import plugin from '../plugin.ts';
import shareMusic from '../components/share-music/index.ts';
import searchTool from '../skills/music/tools/music-search/index.ts';
import shareTool from '../skills/music/tools/music-share/index.ts';
import loginCommand from '../commands/login/[platform]/index.ts';
import searchCommand from '../commands/点歌/[keyword]/index.ts';
import selectionMiddleware from '../middlewares/music-selection/index.ts';
import statusCommand from '../commands/cookie/status/index.ts';
import setCommand from '../commands/cookie/set/[source]/index.ts';
import getCommand from '../commands/cookie/get/[source]/index.ts';
import deleteCommand from '../commands/cookie/delete/[source]/index.ts';
import { formatMusicInfo, resolveSourceAlias, SOURCE_DISPLAY_NAME } from '../src/config.js';
import { formatSearchResults } from '../src/music-lib.js';
import {
  MusicSearchSessions,
  sessionKey,
  resolveMessageIds,
} from '../src/session.js';
import { QQMusicService } from '../src/sources/qq.js';
import { KuwoMusicService } from '../src/sources/kuwo.js';
import { KugouMusicService } from '../src/sources/kugou.js';
import { createMusicServices } from '../src/sources/index.js';
import {
  CredentialStore,
  createInMemoryCredentialDb,
} from '../src/credential-store.js';
import {
  QrLoginRuntime,
  loginSessionKey,
  type QrLoginProvider,
} from '../src/login/index.js';
import type { MusicInfo, MusicSource } from '../src/types.js';
import type { ConversationRef } from '@zhin.js/im-contract';

function conversation(endpointId: string, id: string): ConversationRef {
  return { endpoint: { adapter: 'test', id: endpointId }, kind: 'group', id };
}


function createCredentials(): CredentialStore {
  return new CredentialStore(createInMemoryCredentialDb());
}

describe('@zhin.js/plugin-music', () => {
  it('pins selection language, preserves song text, and uses the actual namespaced command', async () => {
    const sessions = new MusicSearchSessions();
    const runtime = { sessions, services: { qq: { search: async () => [{ id: '1', source: 'qq', title: '中文原名', url: '' }] } } };
    const input = { content: '', metadata: { endpointId: 'ep' }, conversation: conversation('ep', 'chat'), sender: { id: 'user' }, $reply: vi.fn() };
    const context = { input, use: () => runtime, config: {}, params: {}, locale: 'en', formatCommand: (path: string) => `/music ${path}` };
    expect(await searchCommand.execute(context as never)).toContain('/music 点歌 <song>');
    const reply = await searchCommand.execute({ ...context, params: { keyword: '中文原名' } } as never);
    expect(reply).toContain('中文原名');
    expect(reply).toContain('"cancel"');
    const next = vi.fn();
    await selectionMiddleware.handle({ ...context, input: { ...input, content: '取消', locale: 'zh-CN' } } as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(sessions.get(sessionKey(conversation('ep', 'chat'), 'user'))).toBeDefined();
    await selectionMiddleware.handle({ ...context, input: { ...input, content: 'cancel', locale: 'zh-CN' } } as never, next);
    expect(input.$reply).toHaveBeenCalledWith('Music selection cancelled.');
    expect(sessions.get(sessionKey(conversation('ep', 'chat'), 'user'))).toBeUndefined();
  });

  it('pins QR status updates to the locale captured at login start', async () => {
    const provider: QrLoginProvider = {
      createQr: async () => ({ imageSegment: { type: 'image', data: {} }, pollData: {} }),
      pollQr: vi.fn(async (_data, locale) => ({ status: 'expired', message: locale === 'en' ? 'Expired' : '过期' })),
    };
    const logins = new QrLoginRuntime(createCredentials(), { qq: provider, netease: provider });
    await logins.start('qq', 'session', 'en');
    expect(logins.get('session')?.locale).toBe('en');
    expect(await logins.poll('session', async () => {})).toMatchObject({ status: 'expired', message: 'Expired' });
    expect(provider.pollQr).toHaveBeenCalledWith({}, 'en');
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('music');
  });

  it('brands component, commands, and tools', () => {
    expect(parseComponentDefinition(shareMusic)).toBe(shareMusic);
    expect(parseAgentToolDefinition(searchTool)).toBe(searchTool);
    expect(parseAgentToolDefinition(shareTool)).toBe(shareTool);
    expect(parseCommandDefinition(loginCommand)).toBe(loginCommand);
    expect(parseCommandDefinition(statusCommand)).toBe(statusCommand);
    expect(parseCommandDefinition(setCommand)).toBe(setCommand);
    expect(parseCommandDefinition(getCommand)).toBe(getCommand);
    expect(parseCommandDefinition(deleteCommand)).toBe(deleteCommand);
  });

  it('formats music info lines', () => {
    expect(formatMusicInfo({
      title: 'Song',
      artist: 'Artist',
      source: 'qq',
      duration: 125,
    })).toContain('Song');
  });

  it('returns plaintext lyric as-is (nobase64=1)', async () => {
    const lyric = '[00:00.00]第一句歌词\n[00:05.00]第二句歌词';
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      expect(url).toContain('nobase64=1');
      return {
        json: async () => ({ lyric }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const service = new QQMusicService(createCredentials());
      await expect(service.getLyric('some-mid')).resolves.toBe(lyric);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('removes complete HTML tags from Kugou search titles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        data: {
          info: [{
            hash: 'hash-1',
            songname: '<em>海阔</em>天空',
            singername: '信乐团',
            duration: 277,
          }],
        },
      }),
    })));
    try {
      const service = new KugouMusicService();
      await expect(service.search('海阔天空')).resolves.toMatchObject([
        { id: 'hash-1', title: '海阔天空', artist: '信乐团' },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe('source aliases', () => {
    it('resolves common aliases', () => {
      expect(resolveSourceAlias('qq')).toBe('qq');
      expect(resolveSourceAlias('QQ')).toBe('qq');
      expect(resolveSourceAlias('QQ音乐')).toBe('qq');
      expect(resolveSourceAlias('网易云')).toBe('netease');
      expect(resolveSourceAlias('酷我')).toBe('kuwo');
      expect(resolveSourceAlias('酷狗')).toBe('kugou');
    });

    it('returns undefined for unknown alias', () => {
      expect(resolveSourceAlias('bilibili')).toBeUndefined();
    });
  });

  describe('source display names', () => {
    it('covers all sources', () => {
      const sources: MusicSource[] = ['qq', 'netease', 'kuwo', 'kugou'];
      for (const s of sources) {
        expect(SOURCE_DISPLAY_NAME[s]).toBeDefined();
      }
    });
  });

  describe('music services registry', () => {
    it('has all four sources', () => {
      const musicServices = createMusicServices(createCredentials());
      expect(musicServices.qq).toBeInstanceOf(QQMusicService);
      expect(musicServices.kuwo).toBeInstanceOf(KuwoMusicService);
      expect(musicServices.kugou).toBeInstanceOf(KugouMusicService);
      expect(musicServices.netease).toBeDefined();
    });
  });

  describe('formatSearchResults', () => {
    it('formats non-empty results', () => {
      const results: MusicInfo[] = [
        { id: '1', source: 'qq', title: '稻香', artist: '周杰伦', url: '', duration: 248 },
        { id: '2', source: 'qq', title: '晴天', artist: '周杰伦', url: '', duration: 280 },
      ];
      const text = formatSearchResults(results, 'qq');
      expect(text).toContain('QQ音乐');
      expect(text).toContain('1. 稻香 - 周杰伦');
      expect(text).toContain('2. 晴天 - 周杰伦');
      expect(text).toContain('回复序号');
    });

    it('shows not-found for empty results', () => {
      expect(formatSearchResults([], 'kuwo')).toContain('未找到');
    });
  });

  describe('session management', () => {
    const key = sessionKey(conversation('ep1', 'group:123'), 'user:456');

    it('generates consistent session keys', () => {
      expect(JSON.parse(key)).toEqual([['test', 'ep1', 'group', 'group:123', '', '', ''].join('\0'), 'user:456']);
    });

    it('stores and retrieves pending search', () => {
      const sessions = new MusicSearchSessions();
      const search = {
        results: [{ id: '1', source: 'qq' as const, title: 'Test', url: '' }],
        source: 'qq' as const,
        keyword: 'test',
        timestamp: Date.now(),
      };
      sessions.set(key, search);
      const retrieved = sessions.get(key);
      expect(retrieved).toBeDefined();
      expect(retrieved!.keyword).toBe('test');
      sessions.delete(key);
      expect(sessions.get(key)).toBeUndefined();
    });

    it('expires old sessions', () => {
      const sessions = new MusicSearchSessions();
      sessions.set(key, {
        results: [],
        source: 'qq',
        keyword: 'old',
        timestamp: Date.now() - 4 * 60 * 1000,
      });
      expect(sessions.get(key)).toBeUndefined();
    });

    it('cleanExpired removes stale entries', () => {
      const sessions = new MusicSearchSessions();
      const staleKey = sessionKey(conversation('ep', 'g'), 'stale');
      sessions.set(staleKey, {
        results: [],
        source: 'netease',
        keyword: 'stale',
        timestamp: Date.now() - 5 * 60 * 1000,
      });
      sessions.pruneExpired();
      expect(sessions.get(staleKey)).toBeUndefined();
    });

    it('isolates pending selections between runtime owners', () => {
      const first = new MusicSearchSessions();
      const second = new MusicSearchSessions();
      first.set(key, {
        results: [],
        source: 'qq',
        keyword: 'first',
        timestamp: Date.now(),
      });

      expect(first.get(key)?.keyword).toBe('first');
      expect(second.get(key)).toBeUndefined();
    });
  });

  describe('resolveMessageIds', () => {
    it('uses canonical conversation identity and ignores endpoint metadata', () => {
      const chat = conversation('actual', 'conv1');
      expect(resolveMessageIds({ metadata: { endpointId: 'spoofed' }, conversation: chat, sender: { id: 'user1' } }))
        .toEqual({ conversation: chat, senderId: 'user1' });
    });

    it('returns null when canonical identity is missing', () => {
      expect(resolveMessageIds(undefined)).toBeNull();
      expect(resolveMessageIds({})).toBeNull();
      expect(resolveMessageIds({ sender: { id: 'u1' } })).toBeNull();
      expect(resolveMessageIds({ metadata: { endpointId: 'fake' }, conversation: { id: 'c1' }, sender: { id: 'u1' } } as never)).toBeNull();
    });

    it('accepts a full canonical conversation without endpoint metadata', () => {
      const chat = conversation('ep2', 'c1');
      expect(resolveMessageIds({ conversation: chat, sender: { id: 'u1' } })).toEqual({ conversation: chat, senderId: 'u1' });
    });
  });

  describe('qr login session management', () => {
    it('generates login session keys', () => {
      const key = loginSessionKey(conversation('ep1', 'group:1'), 'user:1');
      expect(key).toBe(`login:${sessionKey(conversation('ep1', 'group:1'), 'user:1')}`);
    });

    it('returns undefined for non-existent login', () => {
      const logins = new QrLoginRuntime(createCredentials());
      expect(logins.get('nonexistent')).toBeUndefined();
    });

    it('cancel returns false for non-existent session', () => {
      const logins = new QrLoginRuntime(createCredentials());
      expect(logins.cancel('nonexistent')).toBe(false);
    });

    it('cleanExpiredLogins does not throw on empty map', () => {
      const logins = new QrLoginRuntime(createCredentials());
      expect(() => logins.pruneExpired()).not.toThrow();
    });

    it('isolates active logins between runtime owners', async () => {
      const provider: QrLoginProvider = {
        createQr: vi.fn(async () => ({
          imageSegment: { type: 'image', data: { url: 'https://example.test/qr' } },
          pollData: { token: 'one' },
        })),
        pollQr: vi.fn(async () => ({ status: 'waiting', message: 'waiting' })),
      };
      const providers = { qq: provider, netease: provider };
      const first = new QrLoginRuntime(createCredentials(), providers);
      const second = new QrLoginRuntime(createCredentials(), providers);
      const key = loginSessionKey(conversation('ep', 'group'), 'owner');

      await first.start('qq', key);

      expect(first.get(key)?.pollData).toEqual({ token: 'one' });
      expect(second.get(key)).toBeUndefined();
    });

    it('does not resurrect an in-flight login after runtime disposal', async () => {
      let resolveQr!: (value: Awaited<ReturnType<QrLoginProvider['createQr']>>) => void;
      const provider: QrLoginProvider = {
        createQr: () => new Promise((resolve) => { resolveQr = resolve; }),
        pollQr: vi.fn(async () => ({ status: 'waiting', message: 'waiting' })),
      };
      const logins = new QrLoginRuntime(createCredentials(), {
        qq: provider,
        netease: provider,
      });
      const key = loginSessionKey(conversation('ep', 'group'), 'owner');
      const starting = logins.start('qq', key);

      logins.dispose();
      resolveQr({
        imageSegment: { type: 'image', data: { url: 'https://example.test/qr' } },
        pollData: { token: 'late' },
      });

      await expect(starting).rejects.toThrow('登录已取消');
      expect(logins.get(key)).toBeUndefined();
    });
  });

  describe('credential store', () => {
    it('stores and retrieves credentials', async () => {
      const store = createCredentials();
      await store.set('qq', 'cookie', 'qqmusic_key=abc123');
      const value = await store.get('qq', 'cookie');
      expect(value).toBe('qqmusic_key=abc123');
    });

    it('returns null for missing credentials', async () => {
      expect(await createCredentials().get('netease', 'cookie')).toBeNull();
    });

    it('updates existing credentials', async () => {
      const store = createCredentials();
      await store.set('netease', 'cookie', 'MUSIC_U=old');
      await store.set('netease', 'cookie', 'MUSIC_U=new');
      expect(await store.get('netease', 'cookie')).toBe('MUSIC_U=new');
    });

    it('deletes credentials', async () => {
      const store = createCredentials();
      await store.set('kuwo', 'token', 'abc');
      await store.delete('kuwo', 'token');
      expect(await store.get('kuwo', 'token')).toBeNull();
    });

    it('lists credentials by source', async () => {
      const store = createCredentials();
      await store.set('qq', 'cookie', 'val1');
      await store.set('qq', 'token', 'val2');
      await store.set('netease', 'cookie', 'val3');
      const qqCreds = await store.list('qq');
      expect(qqCreds).toHaveLength(2);
      const allCreds = await store.list();
      expect(allCreds).toHaveLength(3);
    });
  });
});
