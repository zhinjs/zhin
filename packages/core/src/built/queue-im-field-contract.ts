import type { MessageType } from '../message.js';
import type { SendContent, SendOptions } from '../types.js';

export interface QueueEnvelope<TDetail extends Record<string, unknown> = Record<string, unknown>> {
  kind: string;
  type: string;
  detail: TDetail;
  ts?: number | string;
}

export interface NormalizedQueueOutboundDetail {
  context: string;
  bot: string;
  channelId: string;
  channelType: MessageType;
  content: SendContent;
  senderId?: string;
}

export class QueueIMFieldContractError extends Error {
  constructor(
    message: string,
    readonly code: 'missing_field' | 'invalid_type',
    readonly field: string,
  ) {
    super(message);
    this.name = 'QueueIMFieldContractError';
  }
}

const MESSAGE_TYPES = new Set<MessageType>(['group', 'private', 'channel']);

export function isMessageType(value: unknown): value is MessageType {
  return typeof value === 'string' && MESSAGE_TYPES.has(value as MessageType);
}

function pickAlias(record: Record<string, unknown>, preferred: string, fallback: string): unknown {
  return record[preferred] ?? record[fallback];
}

function requireString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  throw new QueueIMFieldContractError(`Missing required queue IM field: ${field}`, 'missing_field', field);
}

function requireContent(value: unknown): SendContent {
  if (value == null) {
    throw new QueueIMFieldContractError('Missing required queue IM field: content', 'missing_field', 'content');
  }
  return value as SendContent;
}

/**
 * Normalize queue outbound aliases into the canonical queue-IM shape.
 *
 * Alias precedence is canonical-first: `context` over `adapter`,
 * `channelId` over `id`, `channelType` over `type`, and `content` over `text`.
 */
export function normalizeQueueOutboundDetail(record: Record<string, unknown>): NormalizedQueueOutboundDetail {
  const context = requireString(pickAlias(record, 'context', 'adapter'), 'context');
  const bot = requireString(record.bot, 'bot');
  const channelId = requireString(pickAlias(record, 'channelId', 'id'), 'channelId');
  const channelTypeValue = pickAlias(record, 'channelType', 'type');
  if (!isMessageType(channelTypeValue)) {
    throw new QueueIMFieldContractError(
      `Invalid queue IM field channelType: ${String(channelTypeValue)}`,
      'invalid_type',
      'channelType',
    );
  }

  const normalized: NormalizedQueueOutboundDetail = {
    context,
    bot,
    channelId,
    channelType: channelTypeValue,
    content: requireContent(pickAlias(record, 'content', 'text')),
  };

  if (typeof record.senderId === 'string') normalized.senderId = record.senderId;
  return normalized;
}

export function toSendOptions(detail: NormalizedQueueOutboundDetail): SendOptions {
  return {
    context: detail.context,
    bot: detail.bot,
    id: detail.channelId,
    type: detail.channelType,
    content: detail.content,
  };
}

export function normalizeRecordToSendOptions(record: Record<string, unknown>): SendOptions {
  return toSendOptions(normalizeQueueOutboundDetail(record));
}

