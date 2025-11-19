// plugins/utils/music/src/sources/index.ts
import { QQMusicService } from './qq.js'
import { NeteaseMusicService } from './netease.js'
import type { MusicSource, MusicSearchService } from '../types.js'

/** 音乐源服务映射 */
export const musicServices: Record<MusicSource, MusicSearchService> = {
  qq: new QQMusicService(),
  netease: new NeteaseMusicService(),
}

export * from './qq.js'
export * from './netease.js'
