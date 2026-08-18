import { defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { searchMusic, formatSearchResults } from '../../src/music-lib.js';
import { resolveSourceAlias, SOURCE_DISPLAY_NAME } from '../../src/config.js';
import { sessionKey, resolveMessageIds, setPending } from '../../src/session.js';
import type { MusicSource } from '../../src/types.js';

interface MusicConfig {
  defaultSource?: MusicSource;
  pageSize?: number;
}

export default defineCommand<MusicConfig, string, Message>({
  description: '搜索音乐并点歌（支持QQ/网易云/酷我/酷狗）',
  params: { keyword: { type: 'string' } },
  shortcut: {
    'QQ点歌': { keyword: '' },
    'qq点歌': { keyword: '' },
    '网易云点歌': { keyword: '' },
    '酷我点歌': { keyword: '' },
    '酷狗点歌': { keyword: '' },
  },
  async execute({ params, config, input }) {
    const rawKeyword = String(params.keyword ?? '').trim();
    if (!rawKeyword) {
      const sources = Object.values(SOURCE_DISPLAY_NAME).join('/');
      return `请输入歌曲名称，如：点歌 稻香\n支持音乐源：${sources}`;
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
      if (!keyword) return '请输入歌曲名称';
    }

    const pageSize = (config as MusicConfig | undefined)?.pageSize ?? 5;
    const result = await searchMusic(keyword, source, pageSize);
    if (result.total === 0) {
      return `[${SOURCE_DISPLAY_NAME[source]}] 未找到"${keyword}"相关歌曲`;
    }

    const ids = input ? resolveMessageIds(input) : null;
    if (ids) {
      const key = sessionKey(ids.endpointId, ids.conversationId, ids.senderId);
      setPending(key, {
        results: result.results,
        source: result.source,
        keyword,
        timestamp: Date.now(),
      });
    }

    return formatSearchResults(result.results, result.source);
  },
});
