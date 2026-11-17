/**
 * `fetchPublicMediaBytes` moved to `@zhin.js/kernel` so the IM core and adapters share the same pinned
 * download (#1250 第 46 批); this module keeps the Agent's public export.
 */
export {
  fetchPublicMediaBytes,
  PUBLIC_MEDIA_FETCH_TIMEOUT_MS,
} from '@zhin.js/kernel';
export type {
  PublicMediaFetchFailure,
  PublicMediaFetchOptions,
  PublicMediaFetchResult,
} from '@zhin.js/kernel';
