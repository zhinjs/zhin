/**
 * Map Plugin Runtime CommandContext.input → classic Message-like shape used by game SessionService.
 *
 * Runtime Message: { conversation, sender?, metadata? }
 * Classic Message: { $adapter, $endpoint, $channel, $sender }
 */
import type { SendContent } from '@zhin.js/core/runtime';

/** A game returns semantic content; Runtime owns native rendering and text fallback. */
export type GameReply = SendContent;

export interface GameMessageLike {
  $adapter: string;
  $endpoint: string;
  $channel: { type: string; id: string };
  // `name` is optional so this stays a structural supertype of the core
  // Message shape (whose $sender.name is string | undefined). That lets the
  // shared game-kit helpers accept both the runtime-bridged GameMessageLike
  // and, during incremental migration, a legacy core Message.
  $sender: { id: string; name?: string };
}

function isClassicMessage(input: unknown): input is GameMessageLike {
  if (!input || typeof input !== 'object') return false;
  const m = input as Record<string, unknown>;
  return (
    typeof m.$adapter === 'string' &&
    m.$channel != null &&
    typeof m.$channel === 'object' &&
    m.$sender != null &&
    typeof m.$sender === 'object'
  );
}

function isRuntimeMessage(input: unknown): input is {
  conversation?: {
    endpoint?: { id?: string; adapter?: string };
    kind?: string;
    id?: string;
  };
  sender?: string;
  metadata?: Readonly<Record<string, unknown>>;
} {
  if (!input || typeof input !== 'object') return false;
  const m = input as Record<string, unknown>;
  return (
    'conversation' in m ||
    'sender' in m ||
    (m.metadata != null && typeof m.metadata === 'object')
  );
}

/** Smoke message when CommandContext has no usable input (unit tests / CLI). */
export function smokeGameMessage(): GameMessageLike {
  return {
    $adapter: 'runtime',
    $endpoint: 'default',
    $channel: { type: 'private', id: 'smoke' },
    $sender: { id: 'smoke', name: 'smoke' },
  };
}

/**
 * Convert CommandContext.input to a Message-like object for game-flow / *-command.
 */
export function messageFromCommandInput(input: unknown): GameMessageLike {
  if (isClassicMessage(input)) return input;

  if (isRuntimeMessage(input)) {
    const meta = input.metadata ?? {};
    const conversation = input.conversation;
    const endpointCapabilityId = typeof conversation?.endpoint?.id === 'string'
      ? conversation.endpoint.id
      : undefined;
    const adapterName = endpointCapabilityId
      ? (endpointCapabilityId.split('\0').pop() ?? endpointCapabilityId).split('~')[0]
      : undefined;
    const adapter = String(adapterName ?? meta.adapter ?? 'runtime');
    const endpoint = String(meta.endpoint ?? meta.endpointId ?? 'default');
    const channelType = String(meta.type ?? meta.channelType ?? conversation?.kind ?? 'private');
    const channelId = String(meta.channelId ?? conversation?.id ?? 'smoke');
    const senderId = String(input.sender ?? meta.senderId ?? 'smoke');
    const senderName = String(meta.senderName ?? meta.name ?? senderId);
    return {
      $adapter: adapter,
      $endpoint: endpoint,
      $channel: { type: channelType, id: channelId },
      $sender: { id: senderId, name: senderName },
    };
  }

  return smokeGameMessage();
}
