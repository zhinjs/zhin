/**
 * Journal-derived event feed (#748).
 *
 * The turn journal is the single source of truth for what happened in a
 * turn. Some facts reach it without passing through the engine stream — most
 * importantly the authority's `tool_call` / `tool_result` / `tool_denied`
 * events, which TurnToolRuntime commits before a tool executes. Stream
 * consumers (the `observe` projection of `executeAgentTurn`) read this feed
 * instead of the raw engine stream, so they see exactly the committed
 * events, in commit order, with the existing TurnEvent shape and no second
 * journal append.
 */
import type { TurnEvent } from '../event/turn-event.js';
import type { TurnJournalPort } from './turn-ingress.js';
import { traceScopeTurnId } from '../trace/turn-trace-registry.js';

export interface JournalFeed {
  /** Start buffering committed events; returns a function that stops it. */
  open(): () => void;
  /** Committed events since the last drain, in commit order. */
  drain(): TurnEvent[];
}

const feeds = new WeakMap<TurnJournalPort, JournalFeed>();

/**
 * Wraps a turn's journal port so every successfully committed event of this
 * turn is also offered to the feed. Events tagged for another (sub-agent)
 * turn stay out of this turn's feed.
 */
export function createJournalFeed(
  journal: TurnJournalPort,
  scope: Readonly<{ turnId: string }>,
): TurnJournalPort {
  let subscribers = 0;
  const pending: TurnEvent[] = [];
  const port: TurnJournalPort = Object.freeze({
    async append(event: TurnEvent) {
      await journal.append(event);
      if (subscribers === 0) return;
      const owner = traceScopeTurnId(event);
      if (owner !== undefined && owner !== scope.turnId) return;
      pending.push(event);
    },
  });
  feeds.set(port, Object.freeze({
    open() {
      subscribers += 1;
      let open = true;
      return () => {
        if (!open) return;
        open = false;
        subscribers -= 1;
        if (subscribers === 0) pending.length = 0;
      };
    },
    drain: () => pending.splice(0),
  }));
  return port;
}

/** The feed attached to a journal port by `createJournalFeed`, if any. */
export function journalFeedOf(journal: TurnJournalPort): JournalFeed | undefined {
  return feeds.get(journal);
}
