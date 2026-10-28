import type { Message } from '../resource-hub/types.js';

import type { InboundQueueConfig, InboundGroupQueueMode, InboundMergeConfig } from '../config/zhin-agent-config.js';

export type { InboundQueueConfig, InboundGroupQueueMode, InboundMergeConfig } from '../config/zhin-agent-config.js';

export interface ResolvedInboundMergeConfig {
  enabled: boolean;
  quietMs: number;
  maxWaitMs: number;
  maxSenders: number;
}

export interface ResolvedInboundQueueConfig {
  groupMode: InboundGroupQueueMode;
  ttlMs: number;
  coalesceWindowMs: number;
  maxQueuedTurns: number;
  merge: ResolvedInboundMergeConfig;
}

export const DEFAULT_INBOUND_MERGE_CONFIG: ResolvedInboundMergeConfig = {
  enabled: true,
  quietMs: 1_500,
  maxWaitMs: 6_000,
  maxSenders: 5,
};

export const DEFAULT_INBOUND_QUEUE_CONFIG: ResolvedInboundQueueConfig = {
  groupMode: 'supersede',
  ttlMs: 180_000,
  coalesceWindowMs: 30_000,
  maxQueuedTurns: 5,
  merge: DEFAULT_INBOUND_MERGE_CONFIG,
};

export function normalizeInboundQueueConfig(
  raw?: InboundQueueConfig | null,
): ResolvedInboundQueueConfig {
  const groupMode = raw?.groupMode === 'fifo' ? 'fifo' : 'supersede';
  const ttlMs = typeof raw?.ttlMs === 'number' && raw.ttlMs >= 0
    ? raw.ttlMs
    : DEFAULT_INBOUND_QUEUE_CONFIG.ttlMs;
  const coalesceWindowMs = typeof raw?.coalesceWindowMs === 'number' && raw.coalesceWindowMs >= 0
    ? raw.coalesceWindowMs
    : DEFAULT_INBOUND_QUEUE_CONFIG.coalesceWindowMs;
  const maxQueuedTurns = typeof raw?.maxQueuedTurns === 'number' && Number.isInteger(raw.maxQueuedTurns) && raw.maxQueuedTurns >= 0
    ? raw.maxQueuedTurns
    : DEFAULT_INBOUND_QUEUE_CONFIG.maxQueuedTurns;
  return { groupMode, ttlMs, coalesceWindowMs, maxQueuedTurns, merge: normalizeInboundMergeConfig(raw?.merge) };
}

function normalizeInboundMergeConfig(raw?: InboundMergeConfig | null): ResolvedInboundMergeConfig {
  const defaults = DEFAULT_INBOUND_MERGE_CONFIG;
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

export function validateInboundQueueConfig(raw?: InboundQueueConfig | null): string[] {
  const errors: string[] = [];
  if (!raw) return errors;
  if (raw.groupMode !== undefined && raw.groupMode !== 'supersede' && raw.groupMode !== 'fifo') {
    errors.push('ai.agent.inboundQueue.groupMode must be supersede or fifo');
  }
  if (raw.ttlMs !== undefined && (typeof raw.ttlMs !== 'number' || !Number.isFinite(raw.ttlMs) || raw.ttlMs < 0)) {
    errors.push('ai.agent.inboundQueue.ttlMs must be a non-negative number');
  }
  if (
    raw.coalesceWindowMs !== undefined
    && (typeof raw.coalesceWindowMs !== 'number' || !Number.isFinite(raw.coalesceWindowMs) || raw.coalesceWindowMs < 0)
  ) {
    errors.push('ai.agent.inboundQueue.coalesceWindowMs must be a non-negative number');
  }
  if (
    raw.maxQueuedTurns !== undefined
    && (typeof raw.maxQueuedTurns !== 'number' || !Number.isInteger(raw.maxQueuedTurns) || raw.maxQueuedTurns < 0)
  ) {
    errors.push('ai.agent.inboundQueue.maxQueuedTurns must be a non-negative integer');
  }
  const merge = raw.merge;
  if (merge !== undefined) {
    if (merge.enabled !== undefined && typeof merge.enabled !== 'boolean') {
      errors.push('ai.agent.inboundQueue.merge.enabled must be a boolean');
    }
    for (const key of ['quietMs', 'maxWaitMs'] as const) {
      const value = merge[key];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        errors.push(`ai.agent.inboundQueue.merge.${key} must be a non-negative number`);
      }
    }
    if (
      merge.maxSenders !== undefined
      && (typeof merge.maxSenders !== 'number' || !Number.isInteger(merge.maxSenders) || merge.maxSenders < 1)
    ) {
      errors.push('ai.agent.inboundQueue.merge.maxSenders must be a positive integer');
    }
  }
  return errors;
}

export function isGroupOrChannelMessage(message: Message): boolean {
  const kind = message.conversation.kind;
  return kind === 'group' || kind === 'channel';
}

export function shouldUseGroupFifoQueue(
  message: Message,
  config: ResolvedInboundQueueConfig,
): boolean {
  return config.groupMode === 'fifo' && isGroupOrChannelMessage(message);
}
