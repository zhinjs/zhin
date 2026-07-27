import { describe, expect, it, vi } from 'vitest';
import { parseComponentDefinition } from '@zhin.js/component';
import { parseAgentToolDefinition } from '@zhin.js/tool';
import plugin from '../plugin.ts';
import shareMusic from '../components/share-music.ts';
import searchTool from '../tools/music-search.ts';
import shareTool from '../tools/music-share.ts';
import { formatMusicInfo } from '../src/config.js';
import { QQMusicService } from '../src/sources/qq.js';

describe('@zhin.js/plugin-music', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('music');
  });

  it('brands component and tools', () => {
    expect(parseComponentDefinition(shareMusic)).toBe(shareMusic);
    expect(parseAgentToolDefinition(searchTool)).toBe(searchTool);
    expect(parseAgentToolDefinition(shareTool)).toBe(shareTool);
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
      const service = new QQMusicService();
      await expect(service.getLyric('some-mid')).resolves.toBe(lyric);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
