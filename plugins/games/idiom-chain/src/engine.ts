export const CHAIN_PREFIX = 'chain';

export type { MatchMode, IdiomEntry, ValidateResult } from './idiom-provider.js';
export {
  idiomCount,
  normalizeInput,
  isKnownIdiom,
  getGloss,
  lastChar,
  lastSyllableNoTone,
  modeLabel,
  getValidNext,
  pickBotIdiom,
  pickStarterIdiom,
  pickHintIdiom,
  validatePlayerIdiom,
  promptLine,
} from './idiom-provider.js';
