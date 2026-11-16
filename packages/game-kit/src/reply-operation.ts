import type { GamePlayer, GameReply } from './command-message.js';
import { reportInboundOutcome } from '@zhin.js/core/runtime';
import { channelKey } from './board-sender.js';

export interface GameOperationScope {
  runInScope<T>(input: Readonly<{ scope: string; run: () => Promise<T> }>): Promise<T>;
}
export interface GameReplyOperation {
  /** The same session service that owns the mutation and migration gate. */
  readonly session: GameOperationScope;
  readonly player: Pick<GamePlayer, 'target'>;
  /** Bound Runtime Message/Session reply; a context-free call has no sending authority. */
  readonly reply: ((content: GameReply) => Promise<unknown>) | undefined;
  readonly run: () => Promise<GameReply | null | undefined>;
  /**
   * The inbound message this operation answers. When the game replied, its outcome is recorded
   * as `handler_replied` / `game_input` (ADR 0061), so the turn reads as game input, not as a
   * policy drop. The caller must then stop dispatch: game input never reaches the Agent (#1250).
   */
  readonly input?: unknown;
}

/**
 * Keep state changes, rendering and the actual outbound outcome in one domain lease.
 * Resolves `true` when the game produced (and sent) a reply, i.e. it consumed the input.
 */
export async function replyGameOperation(input: GameReplyOperation): Promise<boolean> {
  const reply = input.reply;
  if (!reply) throw new TypeError('Game actions require an active IM reply operation');
  return input.session.runInScope({
    scope: channelKey(input.player),
    run: async () => {
      const content = await input.run();
      if (!content) return false;
      await reply(content);
      if (input.input !== undefined) {
        reportInboundOutcome(input.input, { outcome: 'handler_replied', reason: 'game_input', stage: 'middleware' });
      }
      return true;
    },
  });
}
