// plugins/utils/music/src/sources/netease.ts
import type { MusicSearchService, MusicDetail,MusicInfo, Music163 } from '../types.js'

/** 网易云音乐搜索服务 */
export class NeteaseMusicService implements MusicSearchService {
  async search(keyword: string, limit = 10): Promise<MusicInfo[]> {
    try {
      const searchUrl = `http://music.163.com/api/search/get/web?csrf_token=hlpretag=&hlposttag=&s=${encodeURIComponent(keyword)}&type=1&offset=0&total=true&limit=${limit}`
      
      const response = await fetch(searchUrl, { method: 'GET' })
      const data = await response.json() as { result: { songs: Music163[] } }
      const songs = data.result?.songs || []

      return songs.map(music => ({
        id: music.id,
        source: 'netease' as const,
        title: music.name,
        artist: music.artists?.map(a => a.name).join('/'),
        album: music.album.name,
        url: `https://music.163.com/#/song?id=${music.id}`,
        image: music.album.picUrl || music.album.img1v1Url,
        duration: music.duration ? Math.floor(music.duration / 1000) : undefined,
      }))
    } catch (error) {
      console.error('Netease Music search failed:', error)
      return []
    }
  }

  async getCover(id: string): Promise<string | null> {
    try {
      const url = new URL(`https://music.163.com/api/song/detail/?ids=[${id}]`)
      
      const response = await fetch(url, { method: 'GET' })
      const data = await response.json() as { songs: Music163[] }
      
      const song = data.songs?.[0]
      if (!song) return null
      
      return song.album.picUrl || song.album.img1v1Url || null
    } catch (error) {
      console.error('Netease Music get cover failed:', error)
      return null
    }
  }

  async getDetail(id: string): Promise<MusicDetail> {
    const url = new URL(`https://music.163.com/api/song/detail/?ids=[${id}]`)
      
      const response = await fetch(url, { method: 'GET' })
      const data = await response.json() as { songs: Music163[] }
      
      const song = data.songs?.[0]
      if (!song) throw new Error('Music not found')

      return {
        id: song.id,
        source: 'netease',
        title: song.name,
        url: `https://music.163.com/#/song?id=${song.id}`,
        image: song.album.picUrl || song.album.img1v1Url,
        duration: song.duration ? Math.floor(song.duration / 1000) : undefined,
        audio: await this.getAudioUrl(id),
      }
  }

  /**
   * 获取音频直链
   * @param id 音乐 ID
   * @param metingAPI Meting API 地址（可选）
   * @returns 音频直链 URL
   */
  async getAudioUrl(id: string, metingAPI?: string): Promise<string> {
    // 默认使用 Meting API
      const apiUrl = metingAPI || 'https://api.injahow.cn/meting/'
      const url = `${apiUrl}?type=url&id=${id}`
      
      const response = await fetch(url, { method: 'GET' })
      const data = await response.json() as { url?: string, data?: { url?: string } }
      if(!data.url && !data.data?.url) throw new Error('Audio URL not found')
      // 不同的 Meting API 返回格式可能不同
      return data.url || data.data?.url!
  }
}
