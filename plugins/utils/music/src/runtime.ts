import { createToken } from 'zhin.js';
import type { CredentialStore } from './credential-store.js';
import type { MusicSearchService, MusicSource } from './types.js';
import type { MusicSearchSessions } from './session.js';
import type { QrLoginRuntime } from './login/index.js';

export interface MusicRuntime {
  readonly credentials: CredentialStore;
  readonly services: Readonly<Record<MusicSource, MusicSearchService>>;
  readonly sessions: MusicSearchSessions;
  readonly logins: QrLoginRuntime;
}

export const musicRuntimeToken = createToken<MusicRuntime>(
  'zhin.music.runtime',
  'Owner-scoped Music runtime',
);
