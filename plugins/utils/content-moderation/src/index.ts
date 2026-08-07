export {
  DEFAULT_ACTIONS,
  DEFAULT_MODERATION_CONFIG,
  resolveModerationConfig,
} from './config.js';
export {
  shouldBypassInbound,
  shouldBypassOutbound,
} from './bypass.js';
export {
  extractFromOutboundPayload,
  extractFromTextAndSegments,
  buildScanContext,
} from './extract.js';
export {
  redactText,
  redactOutboundPayload,
} from './redact.js';
export {
  ModerationEngine,
  getModerationEngine,
  resetModerationEngine,
  mergeResults,
} from './engine.js';
export type {
  Severity,
  Action,
  OnErrorPolicy,
  Direction,
  ModerationConfig,
  ProviderResult,
  MergedResult,
  ScanInput,
  SourceConfig,
} from './types.js';
export { maxSeverity, SEVERITY_RANK } from './types.js';
export {
  LocalLexiconProvider,
  findMatches,
  findGradedMatches,
  loadWords,
  loadLexiconEntries,
  parseWordFile,
  parseWordLine,
} from './providers/local-lexicon.js';
export { BUILTIN_LEXICON, mergeLexiconEntries } from './providers/builtin-lexicon.js';
export type { LexiconEntry, LexiconSeverity } from './providers/builtin-lexicon.js';
export { HttpModerationProvider, parseHttpResult, isPublicHttpUrl } from './providers/http.js';
export { createProviders } from './providers/registry.js';
