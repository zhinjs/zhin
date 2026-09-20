import { QQMusicService } from './qq.js';
import { NeteaseMusicService } from './netease.js';
import { KuwoMusicService } from './kuwo.js';
import { KugouMusicService } from './kugou.js';
import type { MusicSource, MusicSearchService } from '../types.js';
import type { CredentialStore } from '../credential-store.js';

export function createMusicServices(credentials: CredentialStore): Record<MusicSource, MusicSearchService> {
  return {
    qq: new QQMusicService(credentials),
    netease: new NeteaseMusicService(credentials),
    kuwo: new KuwoMusicService(),
    kugou: new KugouMusicService(),
  };
}

export * from './qq.js';
export * from './netease.js';
export * from './kuwo.js';
export * from './kugou.js';
