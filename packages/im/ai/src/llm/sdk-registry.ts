/** SDK identities retained only for pure legacy input parsing; product Drivers own execution. */
export const SDK_IDS = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'minimax',
  'ollama',
  'openai-compatible',
] as const;

export type SdkId = (typeof SDK_IDS)[number];

export function isSdkId(value: string): value is SdkId {
  return (SDK_IDS as readonly string[]).includes(value);
}

export { normalizeGoogleBaseUrl, normalizeOpenAiCompatibleBaseUrl, normalizeOpenAiBaseUrl, normalizeMiniMaxBaseUrl } from './sdk-endpoints.js';
export { withResponseHeaderTimeout } from './response-header-timeout.js';
