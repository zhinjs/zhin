export {
  formatDuration,
  formatMusicInfo,
  sourceConfigMap,
  SOURCE_ALIASES,
  SOURCE_DISPLAY_NAME,
  resolveSourceAlias,
} from './config.js';
export {
  searchMusic,
  shareMusicDetail,
  formatSearchResults,
  buildMusicShareSegment,
} from './music-lib.js';
export { createMusicServices } from './sources/index.js';
export {
  sessionKey,
  resolveMessageIds,
  setPending,
  getPending,
  clearPending,
  cleanExpired,
  type PendingSearch,
} from './session.js';
export {
  CredentialStore,
  createInMemoryCredentialDb,
  MUSIC_CREDENTIALS_TABLE,
  type CredentialDb,
  type CredentialRow,
} from './credential-store.js';
export { musicRuntimeToken, type MusicRuntime } from './runtime.js';
export {
  startLogin,
  pollLogin,
  cancelLogin,
  getActiveLogin,
  loginSessionKey,
  cleanExpiredLogins,
  type QrLoginSource,
  type QrLoginSession,
  type QrPollResult,
} from './login/index.js';
export type { MusicDetail, MusicInfo, MusicSource, MusicSourceConfig } from './types.js';
