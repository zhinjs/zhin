// plugins/utils/music/src/sources/qq.ts
import type { MusicSearchService, MusicDetail,MusicInfo, MusicQQ } from '../types.js'

/** QQ 音乐搜索服务 */
export class QQMusicService implements MusicSearchService {
  async search(keyword: string, limit = 10): Promise<MusicInfo[]> {
    try {
      const url = new URL('https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg')
      url.searchParams.set('key', keyword)
      url.searchParams.set('format', 'json')
      
      const response = await fetch(url, { method: 'GET' })
      const data = await response.json() as { data: { song: { itemlist: MusicQQ[] } } }
      
      const items = data.data?.song?.itemlist || []
      return items.slice(0, limit).map(music => ({
        id: music.id,
        source: 'qq' as const,
        title: music.name,
        url: `https://y.qq.com/n/yqq/song/${music.mid}.html`
      }))
    } catch (error) {
      console.error('QQ Music search failed:', error)
      return []
    }
  }

  async getCover(id: string): Promise<string | null> {
    try {
      const url = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg')
      url.searchParams.set('format', 'json')
      url.searchParams.set('inCharset', 'utf8')
      url.searchParams.set('outCharset', 'utf-8')
      url.searchParams.set('notice', '0')
      url.searchParams.set('platform', 'yqq.json')
      url.searchParams.set('needNewCode', '0')
      url.searchParams.set('data', JSON.stringify({
        comm: { ct: 24, cv: 0 },
        songinfo: {
          method: 'get_song_detail_yqq',
          param: { song_type: 0, song_mid: '', song_id: parseInt(id) },
          module: 'music.pf_song_detail_svr'
        }
      }))

      const response = await fetch(url, { method: 'GET' })
      const result = await response.json()
      
      const albumMid = result?.songinfo?.data?.track_info?.album?.mid
      if (!albumMid) return null
      
      return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
    } catch (error) {
      console.error('QQ Music get cover failed:', error)
      return null
    }
  }

  async getDetail(id: string): Promise<MusicDetail> {
    const url = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg')
      url.searchParams.set('format', 'json')
      url.searchParams.set('data', JSON.stringify({
        comm: { ct: 24, cv: 0 },
        songinfo: {
          method: 'get_song_detail_yqq',
          param: { song_type: 0, song_mid: '', song_id: parseInt(id) },
          module: 'music.pf_song_detail_svr'
        }
      }))

      const response = await fetch(url, { method: 'GET' })
      const result = await response.json()
      
      const trackInfo = result?.songinfo?.data?.track_info
      if (!trackInfo) throw new Error('Music not found')

      const albumMid = trackInfo.album?.mid
      const image = albumMid 
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
        : undefined

      return {
        id,
        source: 'qq',
        title: trackInfo.name,
        url: `https://y.qq.com/n/yqq/song/${trackInfo.mid}.html`,
        audio: await this.getAudioUrl(id),
        image: image || '',
        duration: trackInfo.interval,
      }
  }

  /**
   * 获取音频直链（需要第三方 API）
   * @param id 音乐 ID
   * @param metingAPI Meting API 地址（可选）
   * @returns 音频直链 URL
   */
  async getAudioUrl(id: string, metingAPI?: string): Promise<string> {
    // QQ 音乐需要使用第三方 API
      const apiUrl = metingAPI || 'https://api.injahow.cn/meting/'
      const url = `${apiUrl}?type=url&id=${id}&source=qq`
      
      const response = await fetch(url, { method: 'GET' })
      const data = await response.json() as { url?: string, data?: { url?: string } }
      if(!data.url && !data.data?.url) {
        throw new Error('Audio URL not found')
      }
      return data.url || data.data?.url!
  }

  /**
   * 获取歌词
   * @param id 音乐 ID
   * @returns 歌词文本
   */
  async getLyric(id: string): Promise<string | null> {
    try {
      const url = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg')
      url.searchParams.set('songmid', id)
      url.searchParams.set('g_tk', '5381')
      url.searchParams.set('format', 'json')
      url.searchParams.set('inCharset', 'utf8')
      url.searchParams.set('outCharset', 'utf-8')
      url.searchParams.set('nobase64', '1')

      const response = await fetch(url, { 
        method: 'GET',
        headers: {
          'Referer': 'https://y.qq.com'
        }
      })
      const data = await response.json() as { lyric?: string }
      
      if (!data.lyric) return null
      
      // QQ 音乐返回的歌词需要 base64 解码
      try {
        return Buffer.from(data.lyric, 'base64').toString('utf-8')
      } catch {
        return data.lyric
      }
    } catch (error) {
      console.error('QQ Music get lyric failed:', error)
      return null
    }
  }
}
