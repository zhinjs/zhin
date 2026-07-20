/**
 * Map Plugin Runtime CommandContext.input → classic Message-like shape used by game SessionService.
 *
 * Runtime Message: { adapter, target, sender?, metadata? }
 * Classic Message: { $adapter, $endpoint, $channel, $sender }
 */

export interface GameMessageLike {
  $adapter: string;
  $endpoint: string;
  $channel: { type: string; id: string };
  $sender: { id: string; name: string };
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
  adapter?: string;
  target?: string;
  sender?: string;
  metadata?: Readonly<Record<string, unknown>>;
} {
  if (!input || typeof input !== 'object') return false;
  const m = input as Record<string, unknown>;
  return (
    'adapter' in m ||
    'target' in m ||
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
    const adapter = String(input.adapter ?? meta.adapter ?? 'runtime');
    const endpoint = String(meta.endpoint ?? meta.endpointId ?? 'default');
    const channelType = String(meta.type ?? meta.channelType ?? 'private');
    const channelId = String(input.target ?? meta.channelId ?? 'smoke');
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
