export type Severity = 'pass' | 'low' | 'medium' | 'high' | 'critical';

export type Action = 'allow' | 'log' | 'reply' | 'redact' | 'drop' | 'recall';

export type OnErrorPolicy = 'open' | 'closed';

export type Direction = 'inbound' | 'outbound';

export interface TextMatch {
  readonly start: number;
  readonly end: number;
}

export interface ExtractedImage {
  /** Index among extracted images (for HTTP / flaggedImageIndexes). */
  readonly index: number;
  /** Index in the original segment list when applicable. */
  readonly segmentIndex?: number;
  readonly url?: string;
  readonly base64?: string;
  readonly mime?: string;
  readonly path?: string;
}

export interface ScanContext {
  readonly adapter: string;
  readonly endpoint: string;
  readonly conversationKind: string;
  readonly conversationId: string;
  readonly sender?: string;
}

export interface ScanInput {
  readonly text: string;
  readonly images: readonly ExtractedImage[];
  readonly direction: Direction;
  readonly context: ScanContext;
}

export interface ProviderResult {
  readonly sourceId: string;
  readonly severity: Severity;
  readonly matches?: readonly TextMatch[];
  readonly flaggedImageIndexes?: readonly number[];
  readonly reason?: string;
  readonly error?: boolean;
}

export interface MergedResult {
  readonly severity: Severity;
  readonly matches: readonly TextMatch[];
  readonly flaggedImageIndexes: readonly number[];
  readonly sources: readonly ProviderResult[];
  readonly reason?: string;
}

/** Graded lexicon item (config `words` entry). */
export interface LexiconWordConfig {
  readonly word: string;
  /** Per-word severity; falls back to source `defaultSeverity`. */
  readonly severity: Exclude<Severity, 'pass'>;
}

export interface LocalSourceConfig {
  readonly id: string;
  readonly type: 'local';
  readonly enabled: boolean;
  readonly onError: OnErrorPolicy;
  /** Custom words with per-entry severity. */
  readonly words: readonly LexiconWordConfig[];
  readonly wordFiles: readonly string[];
  /** Merge built-in graded lexicon (default true). */
  readonly includeBuiltin: boolean;
  /**
   * Default severity for plain string words / ungraded file lines.
   * (Config key may still be written as `severity` for compatibility.)
   */
  readonly defaultSeverity: Exclude<Severity, 'pass'>;
}

export interface HttpSourceConfig {
  readonly id: string;
  readonly type: 'http';
  readonly enabled: boolean;
  readonly onError: OnErrorPolicy;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly forceUpload: boolean;
}

export type SourceConfig = LocalSourceConfig | HttpSourceConfig;

export interface ModerationConfig {
  readonly enabled: boolean;
  readonly onError: OnErrorPolicy;
  readonly maskChar: string;
  readonly replyTemplate: string;
  readonly masters: readonly string[];
  readonly inbound: {
    readonly enabled: boolean;
    readonly bypassMasters: boolean;
    readonly whitelist: {
      readonly userIds: readonly string[];
      readonly conversationIds: readonly string[];
    };
  };
  readonly outbound: {
    readonly enabled: boolean;
    readonly bypass: boolean;
  };
  readonly actions: Readonly<Record<Severity, readonly Action[]>>;
  readonly sources: readonly SourceConfig[];
}

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = Object.freeze({
  pass: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
});

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export function isSeverity(value: unknown): value is Severity {
  return value === 'pass'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'critical';
}

export function isAction(value: unknown): value is Action {
  return value === 'allow'
    || value === 'log'
    || value === 'reply'
    || value === 'redact'
    || value === 'drop'
    || value === 'recall';
}
