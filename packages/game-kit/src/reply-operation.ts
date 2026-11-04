import type { GamePlayer, GameReply } from './command-message.js';
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
}

/** Keep state changes, rendering and the actual outbound outcome in one domain lease. */
export async function replyGameOperation(input: GameReplyOperation): Promise<void> {
  const reply = input.reply;
  if (!reply) throw new TypeError('Game actions require an active IM reply operation');
  await input.session.runInScope({
    scope: channelKey(input.player),
    run: async () => {
      const content = await input.run();
      if (content) await reply(content);
    },
  });
}
