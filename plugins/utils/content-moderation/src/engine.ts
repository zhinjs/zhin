import { formatCompact, getLogger, type Logger } from '@zhin.js/logger';
import { resolveModerationConfig } from './config.js';
import { mergeMatches, type ExtractedContent } from './extract.js';
import { redactOutboundPayload } from './redact.js';
import { createProviders } from './providers/registry.js';
import type { ModerationProvider } from './providers/types.js';
import {
  maxSeverity,
  type Action,
  type Direction,
  type MergedResult,
  type ModerationConfig,
  type ProviderResult,
  type ScanInput,
  type Severity,
} from './types.js';

export interface ApplyHooks {
  readonly reply?: (content: string) => Promise<void>;
  readonly recall?: () => Promise<boolean>;
  readonly replacePayload?: (payload: unknown) => void;
  readonly getPayload?: () => unknown;
}

export interface ApplyResult {
  readonly continue: boolean;
  readonly severity: Severity;
  readonly actions: readonly Action[];
  readonly merged: MergedResult;
  readonly redactedPayload?: unknown;
}

export class ModerationEngine {
  readonly #logger: Logger;
  readonly #cwd: string;
  readonly #fetch?: typeof fetch;
  #providers: readonly ModerationProvider[] = Object.freeze([]);
  #config: ModerationConfig = resolveModerationConfig({});

  constructor(options: {
    readonly logger?: Logger;
    readonly cwd?: string;
    readonly fetch?: typeof fetch;
  } = {}) {
    this.#logger = options.logger ?? getLogger('content-moderation');
    this.#cwd = options.cwd ?? process.cwd();
    this.#fetch = options.fetch;
  }

  get config(): ModerationConfig {
    return this.#config;
  }

  configure(raw: unknown): void {
    this.#config = resolveModerationConfig(raw);
    this.#providers = createProviders(this.#config, {
      cwd: this.#cwd,
      fetch: this.#fetch,
    });
  }

  /** Test helper: inject providers without going through config sources. */
  setProvidersForTest(providers: readonly ModerationProvider[]): void {
    this.#providers = Object.freeze([...providers]);
  }

  async scan(input: ScanInput): Promise<MergedResult> {
    if (this.#providers.length === 0) {
      return Object.freeze({
        severity: 'pass',
        matches: Object.freeze([]),
        flaggedImageIndexes: Object.freeze([]),
        sources: Object.freeze([]),
      });
    }

    const results = await Promise.all(
      this.#providers.map(async (provider) => {
        try {
          return await provider.scan(input);
        } catch (error) {
          return Object.freeze({
            sourceId: provider.id,
            severity: 'pass' as const,
            error: true,
            reason: error instanceof Error ? error.message : String(error),
          }) satisfies ProviderResult;
        }
      }),
    );

    return mergeResults(results);
  }

  async apply(options: {
    readonly direction: Direction;
    readonly extracted: ExtractedContent;
    readonly scanInput: ScanInput;
    readonly hooks: ApplyHooks;
  }): Promise<ApplyResult> {
    const merged = await this.scan(options.scanInput);
    const actions = [...this.#config.actions[merged.severity]];
    const actionSet = new Set<Action>(actions);

    if (merged.severity !== 'pass' || actionSet.has('log')) {
      this.#logger.info(formatCompact({
        op: 'moderation',
        direction: options.direction,
        severity: merged.severity,
        actions: actions.join(','),
        sources: merged.sources.map((s) => `${s.sourceId}:${s.severity}${s.error ? '!' : ''}`).join('|'),
        conversation: options.scanInput.context.conversationId,
        sender: options.scanInput.context.sender,
        reason: merged.reason,
      }));
    }

    if (actionSet.has('log') && merged.severity === 'pass') {
      // already logged above when log is present
    }

    let redactedPayload: unknown | undefined;

    if (actionSet.has('redact')) {
      if (options.direction === 'outbound') {
        const payload = options.hooks.getPayload?.();
        redactedPayload = redactOutboundPayload(payload, options.extracted, {
          maskChar: this.#config.maskChar,
          matches: merged.matches,
          flaggedImageIndexes: merged.flaggedImageIndexes,
        });
        options.hooks.replacePayload?.(redactedPayload);
      }
      // inbound redact：Message 只读，无法改写原文；仍 next() 放行
    }

    if (actionSet.has('reply') && options.direction === 'inbound') {
      try {
        await options.hooks.reply?.(this.#config.replyTemplate);
      } catch (error) {
        this.#logger.warn(formatCompact({
          op: 'moderation_reply_failed',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    } else if (actionSet.has('reply') && options.direction === 'outbound') {
      this.#logger.debug(formatCompact({
        op: 'moderation_reply_skipped',
        direction: 'outbound',
      }));
    }

    if (actionSet.has('recall') && options.direction === 'inbound') {
      try {
        const ok = await options.hooks.recall?.();
        if (!ok) {
          this.#logger.warn(formatCompact({
            op: 'moderation_recall_degraded',
            reason: 'unsupported_or_missing_id',
          }));
        }
      } catch (error) {
        this.#logger.warn(formatCompact({
          op: 'moderation_recall_degraded',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    const stop = shouldStop(options.direction, actionSet);
    return Object.freeze({
      continue: !stop,
      severity: merged.severity,
      actions: Object.freeze(actions),
      merged,
      ...(redactedPayload !== undefined ? { redactedPayload } : {}),
    });
  }
}

export function mergeResults(results: readonly ProviderResult[]): MergedResult {
  let severity: Severity = 'pass';
  const matches = mergeMatches(...results.map((r) => r.matches));
  const flagged = new Set<number>();
  const reasons: string[] = [];

  for (const result of results) {
    severity = maxSeverity(severity, result.severity);
    for (const idx of result.flaggedImageIndexes ?? []) flagged.add(idx);
    if (result.reason) reasons.push(`${result.sourceId}: ${result.reason}`);
  }

  return Object.freeze({
    severity,
    matches,
    flaggedImageIndexes: Object.freeze([...flagged].sort((a, b) => a - b)),
    sources: Object.freeze([...results]),
    ...(reasons.length ? { reason: reasons.join('; ') } : {}),
  });
}

function shouldStop(direction: Direction, actions: ReadonlySet<Action>): boolean {
  if (actions.has('drop')) return true;
  // 入站 recall：尽量撤回后不再进入后续处理（无 allow 时中断）
  if (direction === 'inbound' && actions.has('recall') && !actions.has('allow')) {
    return true;
  }
  return false;
}

let sharedEngine: ModerationEngine | null = null;

export function getModerationEngine(): ModerationEngine {
  if (!sharedEngine) sharedEngine = new ModerationEngine();
  return sharedEngine;
}

export function resetModerationEngine(): void {
  sharedEngine = null;
}
