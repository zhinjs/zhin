/**
 * `ai.agent.mailbox` (ADR 0048 H3, Q4): the IM inbox policy of the host's
 * long-lived Mailbox. Same fields as the removed `ai.agent.inboundQueue`
 * (minus `coalesceWindowMs`, which only served the deleted inbound queue);
 * an old `inboundQueue` key fails startup with {@link MAILBOX_MIGRATION_HINT}.
 */
import type {
  MailboxConfig,
  MailboxGroupMode,
  MailboxMergeConfig,
  MailboxLiveConfig,
  MailboxLiveMode,
} from '../config/zhin-agent-config.js';

export type {
  MailboxConfig,
  MailboxGroupMode,
  MailboxMergeConfig,
  MailboxLiveConfig,
  MailboxLiveMode,
} from '../config/zhin-agent-config.js';

export interface ResolvedMailboxMergeConfig {
  enabled: boolean;
  quietMs: number;
  maxWaitMs: number;
  maxSenders: number;
}

export interface ResolvedMailboxLiveConfig {
  mode: MailboxLiveMode;
  windowMs: number;
  minIntervalMs: number;
}

export interface ResolvedMailboxConfig {
  groupMode: MailboxGroupMode;
  ttlMs: number;
  maxQueuedTurns: number;
  merge: ResolvedMailboxMergeConfig;
  live: ResolvedMailboxLiveConfig;
}

export const DEFAULT_MAILBOX_MERGE_CONFIG: ResolvedMailboxMergeConfig = {
  enabled: true,
  quietMs: 1_500,
  maxWaitMs: 6_000,
  maxSenders: 5,
};

export const DEFAULT_MAILBOX_LIVE_CONFIG: ResolvedMailboxLiveConfig = {
  mode: 'pick-one',
  windowMs: 10_000,
  minIntervalMs: 15_000,
};

export const DEFAULT_MAILBOX_CONFIG: ResolvedMailboxConfig = {
  groupMode: 'supersede',
  ttlMs: 180_000,
  maxQueuedTurns: 5,
  merge: DEFAULT_MAILBOX_MERGE_CONFIG,
  live: DEFAULT_MAILBOX_LIVE_CONFIG,
};

/** Startup error for the renamed key (Q4). */
export const MAILBOX_MIGRATION_HINT = 'ai.agent.inboundQueue was renamed to ai.agent.mailbox (ADR 0048 H3):'
  + ' move groupMode / ttlMs / maxQueuedTurns / merge / live under ai.agent.mailbox and drop coalesceWindowMs.';

export function normalizeMailboxConfig(raw?: MailboxConfig | null): ResolvedMailboxConfig {
  const groupMode = raw?.groupMode === 'fifo' ? 'fifo' : 'supersede';
  const ttlMs = typeof raw?.ttlMs === 'number' && raw.ttlMs >= 0
    ? raw.ttlMs
    : DEFAULT_MAILBOX_CONFIG.ttlMs;
  const maxQueuedTurns = typeof raw?.maxQueuedTurns === 'number' && Number.isInteger(raw.maxQueuedTurns) && raw.maxQueuedTurns >= 0
    ? raw.maxQueuedTurns
    : DEFAULT_MAILBOX_CONFIG.maxQueuedTurns;
  return {
    groupMode,
    ttlMs,
    maxQueuedTurns,
    merge: normalizeMailboxMergeConfig(raw?.merge),
    live: normalizeMailboxLiveConfig(raw?.live),
  };
}

function normalizeMailboxLiveConfig(raw?: MailboxLiveConfig | null): ResolvedMailboxLiveConfig {
  const defaults = DEFAULT_MAILBOX_LIVE_CONFIG;
  const ms = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
  return {
    mode: raw?.mode === 'summary' ? 'summary' : defaults.mode,
    windowMs: ms(raw?.windowMs, defaults.windowMs),
    minIntervalMs: ms(raw?.minIntervalMs, defaults.minIntervalMs),
  };
}

function normalizeMailboxMergeConfig(raw?: MailboxMergeConfig | null): ResolvedMailboxMergeConfig {
  const defaults = DEFAULT_MAILBOX_MERGE_CONFIG;
  const ms = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
  const quietMs = ms(raw?.quietMs, defaults.quietMs);
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : defaults.enabled,
    quietMs,
    // The window never closes before it could go quiet.
    maxWaitMs: Math.max(quietMs, ms(raw?.maxWaitMs, defaults.maxWaitMs)),
    maxSenders: typeof raw?.maxSenders === 'number' && Number.isInteger(raw.maxSenders) && raw.maxSenders >= 1
      ? raw.maxSenders
      : defaults.maxSenders,
  };
}

export function validateMailboxConfig(raw?: MailboxConfig | null): string[] {
  const errors: string[] = [];
  if (!raw) return errors;
  const key = 'ai.agent.mailbox';
  if (raw.groupMode !== undefined && raw.groupMode !== 'supersede' && raw.groupMode !== 'fifo') {
    errors.push(`${key}.groupMode must be supersede or fifo`);
  }
  if (raw.ttlMs !== undefined && (typeof raw.ttlMs !== 'number' || !Number.isFinite(raw.ttlMs) || raw.ttlMs < 0)) {
    errors.push(`${key}.ttlMs must be a non-negative number`);
  }
  if (
    raw.maxQueuedTurns !== undefined
    && (typeof raw.maxQueuedTurns !== 'number' || !Number.isInteger(raw.maxQueuedTurns) || raw.maxQueuedTurns < 0)
  ) {
    errors.push(`${key}.maxQueuedTurns must be a non-negative integer`);
  }
  const merge = raw.merge;
  if (merge !== undefined) {
    if (merge.enabled !== undefined && typeof merge.enabled !== 'boolean') {
      errors.push(`${key}.merge.enabled must be a boolean`);
    }
    for (const field of ['quietMs', 'maxWaitMs'] as const) {
      const value = merge[field];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        errors.push(`${key}.merge.${field} must be a non-negative number`);
      }
    }
    if (
      merge.maxSenders !== undefined
      && (typeof merge.maxSenders !== 'number' || !Number.isInteger(merge.maxSenders) || merge.maxSenders < 1)
    ) {
      errors.push(`${key}.merge.maxSenders must be a positive integer`);
    }
  }
  const live = raw.live;
  if (live !== undefined) {
    if (live.mode !== undefined && live.mode !== 'pick-one' && live.mode !== 'summary') {
      errors.push(`${key}.live.mode must be pick-one or summary`);
    }
    for (const field of ['windowMs', 'minIntervalMs'] as const) {
      const value = live[field];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        errors.push(`${key}.live.${field} must be a non-negative number`);
      }
    }
  }
  return errors;
}
