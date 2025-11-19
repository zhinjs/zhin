// plugins/utils/music/src/config.ts
import type { MusicSourceConfig,MusicSource } from './types.js'

/** 音乐源配置映射 */
export const sourceConfigMap: Record<MusicSource, MusicSourceConfig> = {
  qq: {
    appid: 100497308,
    package: 'com.tencent.qqmusic',
    icon: 'https://p.qpic.cn/qqconnect/0/app_100497308_1626060999/100?max-age=2592000&t=0',
    sign: 'cbd27cd7c861227d013a25b2d10f0799',
    version: '13.11.0.8',
  },
  netease: {
    appid: 100495085,
    package: 'com.netease.cloudmusic',
    icon: 'https://i.gtimg.cn/open/app_icon/00/49/50/85/100495085_100_m.png',
    sign: 'da6b069da1e2982db3e386233f68d76d',
    version: '9.1.92',
  },
}

/** 格式化时长 */
export function formatDuration(seconds?: number): string {
  if (!seconds) return '未知'
  
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/** 格式化音乐信息 */
export function formatMusicInfo(music: {
  title: string
  artist?: string
  album?: string
  duration?: number
  source: string
}): string {
  const parts = [music.title]
  
  if (music.artist) {
    parts.push(music.artist)
  }
  
  if (music.album) {
    parts.push(music.album)
  }
  
  const info = parts.join(' - ')
  const duration = formatDuration(music.duration)
  const source = music.source.toUpperCase()
  
  return `${info} [${duration}] [${source}]`
}
