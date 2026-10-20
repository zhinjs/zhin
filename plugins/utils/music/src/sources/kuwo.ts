import type { MusicSearchService, MusicDetail, MusicInfo } from '../types.js';

interface KuwoSearchItem {
  rid: number;
  name: string;
  artist: string;
  album: string;
  duration: number;
  pic?: string;
  albumpic?: string;
}

export class KuwoMusicService implements MusicSearchService {
  async search(keyword: string, limit = 10): Promise<MusicInfo[]> {
    try {
      const url = new URL('https://search.kuwo.cn/r.s');
      url.searchParams.set('client', 'kt');
      url.searchParams.set('all', keyword);
      url.searchParams.set('pn', '0');
      url.searchParams.set('rn', String(limit));
      url.searchParams.set('ft', 'music');
      url.searchParams.set('encoding', 'utf8');
      url.searchParams.set('rformat', 'json');
      url.searchParams.set('mobi', '1');
      url.searchParams.set('vipver', '1');

      const response = await fetch(url, { method: 'GET' });
      const text = await response.text();
      const data = JSON.parse(text.replace(/'/g, '"')) as {
        abslist?: KuwoSearchItem[];
      };

      const items = data.abslist ?? [];
      return items.slice(0, limit).map((item) => ({
        id: String(item.rid),
        source: 'kuwo' as const,
        title: item.name?.replace(/&nbsp;/g, ' ') ?? '',
        artist: item.artist?.replace(/&nbsp;/g, ' '),
        album: item.album?.replace(/&nbsp;/g, ' '),
        duration: item.duration,
        url: `https://www.kuwo.cn/play_detail/${item.rid}`,
      }));
    } catch {
      return [];
    }
  }

  async getDetail(id: string): Promise<MusicDetail> {
    const url = new URL('https://www.kuwo.cn/api/www/music/musicInfo');
    url.searchParams.set('mid', id);
    url.searchParams.set('httpsStatus', '1');

    const response = await fetch(url, {
      method: 'GET',
      headers: { Referer: 'https://www.kuwo.cn/', csrf: id },
    });
    const result = (await response.json()) as {
      data?: {
        name?: string;
        artist?: string;
        album?: string;
        pic?: string;
        albumpic?: string;
        duration?: number;
      };
    };
    const info = result.data;
    if (!info) throw new Error('Music not found');

    return {
      id,
      source: 'kuwo',
      title: info.name ?? '',
      artist: info.artist,
      album: info.album,
      url: `https://www.kuwo.cn/play_detail/${id}`,
      image: info.pic ?? info.albumpic ?? '',
      audio: await this.getAudioUrl(id),
      duration: info.duration,
    };
  }

  async getAudioUrl(id: string): Promise<string> {
    const url = `https://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=${id}&format=mp3`;
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
    });
    const text = await response.text();
    const match = /http[^\s]+/.exec(text);
    if (match) return match[0];
    throw new Error('Audio URL not found');
  }
}
