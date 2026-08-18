import type { MusicSearchService, MusicDetail, MusicInfo } from '../types.js';

interface KugouSearchItem {
  hash: string;
  songname: string;
  singername: string;
  album_name?: string;
  duration: number;
  album_id?: string;
}

export class KugouMusicService implements MusicSearchService {
  async search(keyword: string, limit = 10): Promise<MusicInfo[]> {
    try {
      const url = new URL('https://mobilecdn.kugou.com/api/v3/search/song');
      url.searchParams.set('format', 'json');
      url.searchParams.set('keyword', keyword);
      url.searchParams.set('page', '1');
      url.searchParams.set('pagesize', String(limit));
      url.searchParams.set('showtype', '1');

      const response = await fetch(url, { method: 'GET' });
      const data = (await response.json()) as {
        data?: { info?: KugouSearchItem[] };
      };

      const items = data.data?.info ?? [];
      return items.slice(0, limit).map((item) => ({
        id: item.hash,
        source: 'kugou' as const,
        title: item.songname?.replace(/<[^>]+>/g, '') ?? '',
        artist: item.singername,
        album: item.album_name,
        duration: item.duration,
        url: `https://www.kugou.com/song/#hash=${item.hash}`,
      }));
    } catch {
      return [];
    }
  }

  async getDetail(id: string): Promise<MusicDetail> {
    const url = new URL('https://wwwapi.kugou.com/yy/index.php');
    url.searchParams.set('r', 'play/getdata');
    url.searchParams.set('hash', id);
    url.searchParams.set('mid', 'music');
    url.searchParams.set('platid', '4');

    const response = await fetch(url, { method: 'GET' });
    const result = (await response.json()) as {
      data?: {
        song_name?: string;
        author_name?: string;
        album_name?: string;
        img?: string;
        play_url?: string;
        timelength?: number;
      };
    };
    const info = result.data;
    if (!info) throw new Error('Music not found');

    const audio = info.play_url ?? '';
    if (!audio) throw new Error('Audio URL not found');

    return {
      id,
      source: 'kugou',
      title: info.song_name ?? '',
      artist: info.author_name,
      album: info.album_name,
      url: `https://www.kugou.com/song/#hash=${id}`,
      image: info.img ?? '',
      audio,
      duration: info.timelength ? Math.floor(info.timelength / 1000) : undefined,
    };
  }
}
