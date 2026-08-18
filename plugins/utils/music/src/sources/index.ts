import { QQMusicService } from './qq.js';
import { NeteaseMusicService } from './netease.js';
import { KuwoMusicService } from './kuwo.js';
import { KugouMusicService } from './kugou.js';
import type { MusicSource, MusicSearchService } from '../types.js';

export const musicServices: Record<MusicSource, MusicSearchService> = {
  qq: new QQMusicService(),
  netease: new NeteaseMusicService(),
  kuwo: new KuwoMusicService(),
  kugou: new KugouMusicService(),
};

export * from './qq.js';
export * from './netease.js';
export * from './kuwo.js';
export * from './kugou.js';
