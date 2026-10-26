/**
 * Map Plugin Runtime CommandContext.input → classic Message-like shape used by game SessionService.
 *
 * Runtime Message: { conversation, sender?, metadata? }
 * Classic Message: { $adapter, $endpoint, $channel, $sender }
 */
import type { SendContent } from '@zhin.js/core/runtime';
import { resolveLocale, type Locale } from '@zhin.js/plugin-runtime';

/** A game returns semantic content; Runtime owns native rendering and text fallback. */
export type GameReply = SendContent;

export interface GameMessageLike {
  readonly locale?: Locale;
  readonly formatCommand?: (localPath: string) => string | undefined;
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

/** Runtime `Message.sender` (structured) — older callers passed a bare id string. */
interface RuntimeSenderRef {
  readonly id?: string;
  readonly name?: string;
}

function readSenderId(sender: string | RuntimeSenderRef | undefined): string | undefined {
  if (typeof sender === 'string') return sender || undefined;
  if (typeof sender?.id === 'string' && sender.id) return sender.id;
  return undefined;
}

function readSenderName(sender: string | RuntimeSenderRef | undefined): string | undefined {
  if (typeof sender !== 'object') return undefined;
  if (typeof sender.name === 'string' && sender.name.trim()) return sender.name;
  return undefined;
}

function isRuntimeMessage(input: unknown): input is {
  readonly locale?: Locale;
  readonly formatCommand?: (localPath: string) => string | undefined;
  conversation?: {
    endpoint?: { id?: string; adapter?: string };
    kind?: string;
    id?: string;
  };
  sender?: string | RuntimeSenderRef;
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
    locale: 'zh-CN',
    $adapter: 'runtime',
    $endpoint: 'default',
    $channel: { type: 'private', id: 'smoke' },
    $sender: { id: 'smoke', name: 'smoke' },
  };
}

/**
 * Convert CommandContext.input to a Message-like object for game-flow / *-command.
 */
export function messageFromCommandInput(input: unknown, presentation?: Readonly<{
  locale?: Locale;
  formatCommand?: (localPath: string) => string | undefined;
}>): GameMessageLike {
  if (isClassicMessage(input)) return presentation ? { ...input,
    locale: presentation.locale ?? input.locale,
    formatCommand: presentation.formatCommand ?? input.formatCommand,
  } : input;

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
    const endpoint = String(meta.endpoint ?? meta.endpointKey ?? 'default');
    const channelType = String(meta.type ?? meta.channelType ?? conversation?.kind ?? 'private');
    const channelId = String(meta.channelId ?? conversation?.id ?? 'smoke');
    const senderId = String(readSenderId(input.sender) ?? meta.senderId ?? 'smoke');
    const senderName = String(readSenderName(input.sender) ?? meta.senderName ?? meta.name ?? senderId);
    return {
      locale: resolveLocale(presentation?.locale ?? input.locale),
      formatCommand: presentation?.formatCommand ?? (typeof input.formatCommand === 'function'
        ? input.formatCommand.bind(input) : undefined),
      $adapter: adapter,
      $endpoint: endpoint,
      $channel: { type: channelType, id: channelId },
      $sender: { id: senderId, name: senderName },
    };
  }

  return { ...smokeGameMessage(), ...presentation };
}
