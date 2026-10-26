import { messages as t, sourceName, usage } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { searchMusic, formatSearchResults } from '../../../src/music-lib.js';
import { resolveSourceAlias } from '../../../src/config.js';
import { sessionKey, resolveMessageIds } from '../../../src/session.js';
import type { MusicSource } from '../../../src/types.js';
import { musicRuntimeToken } from '../../../src/runtime.js';

interface MusicConfig {
  defaultSource?: MusicSource;
  pageSize?: number;
}

export default defineCommand<MusicConfig, string, Message>({
  alias: ['music search'],
  preferredAliasI18n: { en: 'music search' },
  description: '搜索音乐并点歌（支持QQ/网易云/酷我/酷狗）', descriptionI18n: { en: "Search for music and play a track (QQ, NetEase, Kuwo and Kugou)" },
  params: { keyword: { type: 'string' } },
  shortcut: {
    'QQ点歌': { keyword: '' },
    'qq点歌': { keyword: '' },
    '网易云点歌': { keyword: '' },
    '酷我点歌': { keyword: '' },
    '酷狗点歌': { keyword: '' },
  },
  async execute({ params, config, input, use, locale, formatCommand }) {
    const rawKeyword = String(params.keyword ?? '').trim();
    if (!rawKeyword) {
      const sources = (['qq', 'netease', 'kuwo', 'kugou'] as const).map(source => sourceName(source, locale)).join('/');
      return [t(locale, 'keyword'), usage(locale, formatCommand('点歌') === undefined ? undefined : `${formatCommand('点歌')} <song>`), t(locale, 'sources', { sources })].filter(Boolean).join('\n');
    }

    let source: MusicSource = (config as MusicConfig | undefined)?.defaultSource ?? 'qq';
    let keyword = rawKeyword;

    const triggerText = input?.content?.trim() ?? '';
    for (const [prefix, s] of Object.entries({
      'QQ点歌': 'qq',
      'qq点歌': 'qq',
      '网易云点歌': 'netease',
      '酷我点歌': 'kuwo',
      '酷狗点歌': 'kugou',
    } as Record<string, MusicSource>)) {
      if (triggerText.startsWith(prefix)) {
        source = s;
        keyword = triggerText.slice(prefix.length).trim() || rawKeyword;
        break;
      }
    }

    const sourceFromKeyword = resolveSourceAlias(keyword.split(/\s+/)[0] ?? '');
    if (sourceFromKeyword) {
      source = sourceFromKeyword;
      keyword = keyword.slice(keyword.indexOf(' ') + 1).trim();
      if (!keyword) return t(locale, 'keyword');
    }

    const pageSize = (config as MusicConfig | undefined)?.pageSize ?? 5;
    const result = await searchMusic(use(musicRuntimeToken), keyword, source, pageSize);
    if (result.total === 0) {
      return t(locale, 'noMatch', { source: sourceName(source, locale), keyword });
    }

    const ids = input ? resolveMessageIds(input) : null;
    if (ids) {
      const key = sessionKey(ids.conversation, ids.senderId);
      use(musicRuntimeToken).sessions.set(key, {
        locale,
        results: result.results,
        source: result.source,
        keyword,
        timestamp: Date.now(),
      });
    }

    return formatSearchResults(result.results, result.source, locale);
  },
});
