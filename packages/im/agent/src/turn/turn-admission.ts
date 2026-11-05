/**
 * What an IM turn learns from the host Mailbox when its message is admitted
 * (ADR 0048 H3). The shapes are those of the former `TurnAdmissionGate`
 * (#725, ADR 0038), now produced by {@link HostMailbox} from the harness
 * Mailbox and its inbox policy.
 */
import type { Harness, Mail, TrustLevel, VenueRef } from '@zhin.js/harness';
import type { TurnAccessContext } from './turn-ingress.js';

export { DEFAULT_MAX_QUEUED_TURNS, LIVE_WINDOW_MAX_MESSAGES } from '@zhin.js/harness';

export interface TurnAdmissionRequest {
  /** The IM session (Mailbox lane, D1). */
  readonly sessionKey: string;
  readonly senderId: string;
  readonly text: string;
  /**
   * Plain text without media, quotes or forwards. Only plain-text messages are
   * merged, because a merged turn keeps the first message's attachments only.
   */
  readonly plainText: boolean;
  /**
   * May join a merge window (ADR 0038 §1): the caller has checked it is a
   * plain-text group message from a non-master sender, not a command, stop or
   * approval. Ignored while the mailbox has no merge window.
   */
  readonly mergeable?: boolean;
  /** A danmaku of a `liveDanmaku` conversation (ADR 0038 §5): it joins the room's danmaku window. */
  readonly live?: boolean;
  /** Display name for the merged turn text. */
  readonly senderName?: string;
  /** Platform message id; a merged turn lists it so the reply can point at it (ADR 0038 §3). */
  readonly messageId?: string;
  /**
   * The sender's own access (ADR 0038 §2). Carried into `participants` so a
   * merged turn can narrow capabilities to what every member may use.
   */
  readonly access?: TurnAccessContext;
  /** Called synchronously when the message joins a merge window (audit `merge_window_joined`). */
  readonly onWindowJoined?: (window: TurnMergeWindowSnapshot) => void;
  /** Entry actor (the venue's default agent binding). Default `zhin`. */
  readonly entry?: string;
  /** Harness trust of the sender (principal of the human Mail). Default `group_member`. */
  readonly trust?: TrustLevel;
  readonly isMaster?: boolean;
  readonly venue?: VenueRef;
  /** An ordinary group message that neither @s nor replies to the bot: never admitted (`not_addressed`). */
  readonly unaddressed?: boolean;
  /** Body kind of the root Mail. `event` = a scene event (H3, Q3). Default `human`. */
  readonly kind?: 'human' | 'event';
  /** Scene event name for `kind: 'event'`. */
  readonly event?: string;
}

/** One sender's messages in a merged turn, in arrival order. */
export interface TurnParticipant {
  readonly senderId: string;
  readonly senderName?: string;
  readonly texts: readonly string[];
  /** Merge / danmaku window participants only: ids of the messages behind `texts`, when known. */
  readonly messageIds?: readonly string[];
  /** The access given with the sender's first message, when the caller passed one. */
  readonly access?: TurnAccessContext;
}

export interface TurnMergeWindowSnapshot {
  /** Senders in the window, in join order. */
  readonly senders: readonly string[];
  readonly messages: number;
}

/** Facts about how a turn was admitted; recorded on its TurnTrace. */
export interface TurnAdmissionFacts {
  /** Milliseconds spent waiting for an earlier turn of the session. */
  readonly queuedMs: number;
  /** Number of user messages folded into this turn (1 = no merge). */
  readonly mergedMessages: number;
  /** True when this turn replaced the sender's own unanswered turn. */
  readonly supersededPrevious: boolean;
  /** Present when the turn was flushed from a merge window. */
  readonly mergeWindow?: TurnMergeWindowSnapshot & Readonly<{ waitedMs: number }>;
  /** Present when the turn answers a danmaku window. */
  readonly liveWindow?: TurnLiveWindowSnapshot;
}

export interface TurnLiveWindowSnapshot {
  /** Danmaku that arrived in the window, including evicted ones. */
  readonly candidates: number;
  /** Danmaku the turn sees (at most `LIVE_WINDOW_MAX_MESSAGES`). */
  readonly kept: number;
  readonly senders: number;
  readonly waitedMs: number;
}

/**
 * Pre-send verdict (ADR 0038 §4). `discard` drops the reply; `send` with a
 * reason means the reply is stale but goes out anyway. `senders` are the
 * turn's senders who followed up while it ran.
 */
export type TurnStaleVerdict =
  | Readonly<{ kind: 'fresh' }>
  | Readonly<{ kind: 'discard'; senders: readonly string[] }>
  | Readonly<{ kind: 'send'; senders: readonly string[]; reason: 'acted' | 'starvation' }>;

export type TurnAdmissionRejectReason = 'queue_full' | 'expired' | 'stopped' | 'not_addressed';

export type TurnAdmission =
  | Readonly<{
      kind: 'run';
      text: string;
      facts: TurnAdmissionFacts;
      /**
       * Whose messages this turn answers. One entry for an ordinary turn; a
       * merged turn lists every sender (the carrier whose handler runs the turn
       * may be absent when it stopped its own messages).
       */
      participants: readonly TurnParticipant[];
      /** Aborted when the turn is superseded or stopped by the inbox. */
      signal: AbortSignal;
      /** Call once a reply has been delivered; later messages then queue instead of superseding. */
      markDelivered: () => void;
      /** Call when the turn did something that must be reported (tool call, hard gate). */
      markActed: () => void;
      /**
       * Ask before each send. The first `discard` moves this turn's messages
       * into the follow-up window; later calls keep answering `discard`.
       */
      staleCheck: () => TurnStaleVerdict;
      /** Must be called exactly once when the turn ends. */
      release: (status?: 'completed' | 'failed' | 'cancelled') => void;
      /** The Mail batch this turn answers (Q2: first mail carries the turn). */
      batch: readonly Mail[];
      /** The mail the turn's collaboration tools act on: the first mail, with the batch's intersected authority. */
      mail: Mail;
      /** The long-lived harness the mail lives in. */
      harness: Harness;
    }>
  | Readonly<{ kind: 'merged' }>
  | Readonly<{ kind: 'rejected'; reason: TurnAdmissionRejectReason }>;

export type TurnStopResult = 'stopped' | 'not_running' | 'forbidden';
