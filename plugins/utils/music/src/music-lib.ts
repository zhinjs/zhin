import { musicServices } from './sources/index.js';
import { sourceConfigMap, SOURCE_DISPLAY_NAME, formatDuration } from './config.js';
import type { MusicInfo, MusicDetail, MusicSource } from './types.js';

export async function searchMusic(
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
  const service = musicServices[s];
  const results = await service.search(keyword, limit);
  return {
    success: true,
    keyword,
    source: s,
    results,
    total: results.length,
  };
}

export async function shareMusicDetail(id: string, source: MusicSource) {
  const service = musicServices[source];
  if (!service) {
    return { success: false as const, error: `不支持的音乐源: ${source}` };
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

export function formatSearchResults(results: readonly MusicInfo[], source: MusicSource): string {
  const sourceName = SOURCE_DISPLAY_NAME[source] ?? source;
  if (results.length === 0) return `[${sourceName}] 未找到相关歌曲`;
  const lines = results.map((m, i) => {
    const parts = [m.title];
    if (m.artist) parts.push(m.artist);
    const duration = m.duration ? ` [${formatDuration(m.duration)}]` : '';
    return `${i + 1}. ${parts.join(' - ')}${duration}`;
  });
  return `[${sourceName}] 搜索结果：\n${lines.join('\n')}\n\n回复序号播放，回复"取消"取消选择`;
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
