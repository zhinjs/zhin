import type { SendContent } from '@zhin.js/core/runtime';
import { createDeliveryTarget, resolveLocale, type DeliveryTarget, type Locale } from '@zhin.js/plugin-runtime';

/** A game returns semantic content; Runtime owns native rendering and text fallback. */
export type GameReply = SendContent;

/** A player's immutable identity and exact scene; presentation callbacks remain operation-bound. */
export interface GamePlayer {
  readonly target: DeliveryTarget;
  readonly sender: Readonly<{ id: string; name?: string }>;
  readonly locale?: Locale;
  readonly formatCommand?: (localPath: string) => string | undefined;
}

/** Capture trusted public message fields once. Missing actors are never fabricated. */
export function gamePlayerFromInput(
  input: unknown,
  presentation?: Readonly<{
    locale?: Locale;
    formatCommand?: (localPath: string) => string | undefined;
  }>,
): GamePlayer {
  if (!input || typeof input !== 'object') throw new TypeError('Game actions require an IM conversation and sender');
  const source = input as {
    conversation: DeliveryTarget;
    sender?: { id?: unknown; name?: unknown };
    locale?: Locale;
    formatCommand?: (path: string) => string | undefined;
  };
  if (typeof source.sender?.id !== 'string' || !source.sender.id) {
    throw new TypeError('Game actions require a real sender');
  }
  return Object.freeze({
    target: createDeliveryTarget(source),
    sender: Object.freeze({
      id: source.sender.id,
      ...(typeof source.sender.name === 'string' ? { name: source.sender.name } : {}),
    }),
    locale: resolveLocale(presentation?.locale ?? source.locale),
    formatCommand: presentation?.formatCommand ?? source.formatCommand?.bind(input),
  });
}
