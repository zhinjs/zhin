import { createToken } from 'zhin.js';
import type { CredentialStore } from './credential-store.js';
import type { MusicSearchService, MusicSource } from './types.js';

export interface MusicRuntime {
  readonly credentials: CredentialStore;
  readonly services: Readonly<Record<MusicSource, MusicSearchService>>;
}

export const musicRuntimeToken = createToken<MusicRuntime>(
  'zhin.music.runtime',
  'Owner-scoped Music runtime',
);
