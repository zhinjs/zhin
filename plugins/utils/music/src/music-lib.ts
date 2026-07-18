import { musicServices } from './sources/index.js';
import type { MusicInfo, MusicSource } from './types.js';

export async function searchMusic(
  keyword: string,
  source?: MusicSource,
  limit = 5,
): Promise<{
  success: true;
  keyword: string;
  results: Array<{ id: string; title: string; source: string; url: string }>;
  total: number;
}> {
  const searchSources: MusicSource[] = source ? [source] : ['qq', 'netease'];
  const searchResults = await Promise.all(
    searchSources.map((s) => musicServices[s].search(keyword, limit)),
  );
  const allMusic = searchResults.flat().filter(Boolean) as MusicInfo[];
  return {
    success: true,
    keyword,
    results: allMusic.map((m) => ({
      id: m.id,
      title: m.title,
      source: m.source,
      url: m.url,
    })),
    total: allMusic.length,
  };
}

export async function shareMusicDetail(id: string, source: MusicSource) {
  const service = musicServices[source];
  if (!service) {
    return { success: false as const, error: `不支持的音乐源: ${source}` };
  }
  try {
    const detail = await service.getDetail(id);
    return {
      success: true as const,
      music: {
        id: detail.id,
        title: detail.title,
        source: detail.source,
        url: detail.url,
        image: detail.image,
        audio: detail.audio,
        duration: detail.duration,
      },
    };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
