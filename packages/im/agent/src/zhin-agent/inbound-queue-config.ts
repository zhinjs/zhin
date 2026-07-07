import type { Message } from '../orchestrator/types.js';

export type InboundGroupQueueMode = 'supersede' | 'fifo';

export interface InboundQueueConfig {
  /** 群/频道入站 @ 排队模式；私聊始终 supersede */
  groupMode?: InboundGroupQueueMode;
  /** 队列项 TTL（毫秒）；超时丢弃 */
  ttlMs?: number;
  /** 同用户合并窗口（毫秒）；队尾同 sender 追加文本 */
  coalesceWindowMs?: number;
}

export interface ResolvedInboundQueueConfig {
  groupMode: InboundGroupQueueMode;
  ttlMs: number;
  coalesceWindowMs: number;
}

export const DEFAULT_INBOUND_QUEUE_CONFIG: ResolvedInboundQueueConfig = {
  groupMode: 'supersede',
  ttlMs: 180_000,
  coalesceWindowMs: 30_000,
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
  return { groupMode, ttlMs, coalesceWindowMs };
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
  return errors;
}

export function isGroupOrChannelMessage(message: Message): boolean {
  const kind = message.$channel?.type;
  return kind === 'group' || kind === 'channel';
}

export function shouldUseGroupFifoQueue(
  message: Message,
  config: ResolvedInboundQueueConfig,
): boolean {
  return config.groupMode === 'fifo' && isGroupOrChannelMessage(message);
}
