import * as crypto from 'node:crypto';
import type { MusicSearchService, MusicDetail, MusicInfo } from '../types.js';
import { getCredential } from '../credential-store.js';

const md5 = (text: string) => crypto.createHash('md5').update(text).digest('hex');

const MUSICU_API = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

function getHeaders(cookie?: string | null) {
  return {
    Referer: 'https://y.qq.com',
    Cookie: cookie ?? '',
    'Content-Type': 'application/json; charset=UTF-8',
  };
}

export class QQMusicService implements MusicSearchService {
  async search(keyword: string, limit = 10): Promise<MusicInfo[]> {
    try {
      const cookie = await getCredential('qq', 'cookie');
      const response = await fetch(MUSICU_API, {
        method: 'POST',
        headers: getHeaders(cookie),
        body: JSON.stringify({
          comm: { uin: '0', authst: '', ct: 29 },
          search: {
            method: 'DoSearchForQQMusicMobile',
            module: 'music.search.SearchCgiService',
            param: {
              query: keyword,
              grp: 1,
              num_per_page: limit,
              page_num: 1,
              search_type: 0,
              searchid: String(Date.now()),
            },
          },
        }),
      });

      const data = (await response.json()) as { code?: number; search?: { data?: { body?: { song?: { list?: any[] }; item_song?: any[] } } } };
      if (data.code !== undefined && +data.code !== 0) return [];

      const body = data.search?.data?.body ?? {};
      const list = (body.song?.list ?? body.item_song ?? []) as any[];

      return list.slice(0, limit).map((e) => {
        const mid = e?.mid ?? '';
        const albumMid = e?.album?.pmid ?? e?.album?.mid ?? '';
        const singerMid = e?.singer?.[0]?.pmid ?? e?.singer?.[0]?.mid ?? '';
        const cover = albumMid
          ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
          : singerMid
            ? `https://y.qq.com/music/photo_new/T001R300x300M000${singerMid}.jpg`
            : '';

        return {
          id: String(e.id),
          source: 'qq' as const,
          title: e.name,
          artist: (e.singer ?? []).map((s: any) => s.name).join('/'),
          album: e.album?.name,
          url: `https://y.qq.com/n/ryqq/songDetail/${mid}`,
          image: cover,
          duration: e.interval,
          _mid: mid,
          _mediaMid: e.file?.media_mid,
        };
      });
    } catch (error) {
      console.error('QQ Music search failed:', error);
      return [];
    }
  }

  async getDetail(id: string): Promise<MusicDetail> {
    const url = new URL(MUSICU_API);
    url.searchParams.set('format', 'json');
    url.searchParams.set('data', JSON.stringify({
      comm: { ct: 24, cv: 0 },
      songinfo: {
        method: 'get_song_detail_yqq',
        param: { song_type: 0, song_mid: '', song_id: parseInt(id) },
        module: 'music.pf_song_detail_svr',
      },
    }));

    const response = await fetch(url, { method: 'GET' });
    const result = await response.json() as any;

    const trackInfo = result?.songinfo?.data?.track_info;
    if (!trackInfo) throw new Error('Music not found');

    const albumMid = trackInfo.album?.mid;
    const image = albumMid
      ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
      : '';

    return {
      id,
      source: 'qq',
      title: trackInfo.name,
      url: `https://y.qq.com/n/ryqq/songDetail/${trackInfo.mid}`,
      audio: await this.getAudioUrl(id, trackInfo.mid, trackInfo.file?.media_mid),
      image,
      duration: trackInfo.interval,
    };
  }

  async getAudioUrl(id: string, mid?: string, mediaMid?: string): Promise<string> {
    const cookie = await getCredential('qq', 'cookie');
    if (cookie) {
      try {
        const uin = /uin=o?(\d+)/.exec(cookie)?.[1] ?? '0';
        const songMid = mid ?? id;
        const response = await fetch(MUSICU_API, {
          method: 'POST',
          headers: getHeaders(cookie),
          body: JSON.stringify({
            comm: {
              ct: 19,
              cv: '1891',
              uin: '0',
              guid: md5(`${uin}music`),
              tmeAppID: 'qqmusic',
              tmeLoginType: 2,
            },
            vkey: {
              module: 'vkey.GetVkeyServer',
              method: 'CgiGetVkey',
              param: {
                guid: md5(String(Date.now())),
                songmid: [songMid],
                songtype: [0],
                uin: '0',
                ctx: 1,
                filename: [`C400${id}${mediaMid ?? songMid}.m4a`],
              },
            },
          }),
        });

        const result = await response.json() as any;
        if (result.vkey && +result.vkey.code === 0) {
          const purl = result.vkey.data?.midurlinfo?.[0]?.purl;
          if (purl) return `https://ws.stream.qqmusic.qq.com/${purl}`;
        }
      } catch {
        // fall through to public fallback
      }
    }

    // 无 cookie 的公开 fallback：md5 签名直链
    const songMid = mid ?? id;
    const code = md5(`${songMid}q;z(&l~sdf2!nK`).substring(0, 5).toUpperCase();
    return `https://c6.y.qq.com/rsc/fcgi-bin/fcg_pyq_play.fcg?songmid=${songMid}&code=${code}`;
  }

  async getLyric(id: string): Promise<string | null> {
    try {
      const url = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
      url.searchParams.set('songmid', id);
      url.searchParams.set('g_tk', '5381');
      url.searchParams.set('format', 'json');
      url.searchParams.set('inCharset', 'utf8');
      url.searchParams.set('outCharset', 'utf-8');
      url.searchParams.set('nobase64', '1');

      const response = await fetch(url, {
        method: 'GET',
        headers: { Referer: 'https://y.qq.com' },
      });
      const data = (await response.json()) as { lyric?: string };
      return data.lyric ?? null;
    } catch (error) {
      console.error('QQ Music get lyric failed:', error);
      return null;
    }
  }
}
