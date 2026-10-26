import type { Locale } from 'zhin.js/i18n';
import { messages as t, sourceName as displayName } from './i18n.js';
import { sourceConfigMap, formatDuration } from './config.js';
import type { MusicInfo, MusicDetail, MusicSource } from './types.js';
import type { MusicRuntime } from './runtime.js';

export async function searchMusic(
  runtime: MusicRuntime,
  keyword: string,
  source?: MusicSource,
  limit = 5,
): Promise<{
  success: true;
  keyword: string;
  source: MusicSource;
  results: MusicInfo[];
  total: number;
}> {
  const s: MusicSource = source ?? 'qq';
  const service = runtime.services[s];
  const results = await service.search(keyword, limit);
  return {
    success: true,
    keyword,
    source: s,
    results,
    total: results.length,
  };
}

export async function shareMusicDetail(runtime: MusicRuntime, id: string, source: MusicSource, locale: Locale = 'zh-CN') {
  const service = runtime.services[source];
  if (!service) {
    return { success: false as const, error: t(locale, 'unsupported', { source }) };
  }
  try {
    const detail = await service.getDetail(id);
    return { success: true as const, music: detail };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function formatSearchResults(results: readonly MusicInfo[], source: MusicSource, locale: Locale = 'zh-CN'): string {
  const sourceName = displayName(source, locale) ?? source;
  if (results.length === 0) return t(locale, 'noResults', { source: sourceName });
  const lines = results.map((m, i) => {
    const parts = [m.title];
    if (m.artist) parts.push(m.artist);
    const duration = m.duration ? ` [${formatDuration(m.duration)}]` : '';
    return `${i + 1}. ${parts.join(' - ')}${duration}`;
  });
  return t(locale, 'results', { source: sourceName, lines: lines.join('\n') });
}

export function buildMusicShareSegment(detail: MusicDetail) {
  const config = sourceConfigMap[detail.source];
  return {
    type: 'share' as const,
    data: {
      title: detail.title,
      url: detail.url,
      image: detail.image,
      audio: detail.audio,
      duration: detail.duration,
      artist: detail.artist,
      config,
    },
  };
}
