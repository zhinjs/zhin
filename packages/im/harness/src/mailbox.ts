/**
 * Mailbox scheduler (ADR 0048 §3.1).
 *
 * Semantics:
 * - Key = (mail.to, mail.engagementId). Mails for a key queue FIFO. At most one
 *   turn runs per key at a time; different keys run in parallel, bounded by
 *   `maxConcurrentTurns` across all keys.
 * - Fairness: when a slot frees, the next key to start is the one whose oldest
 *   waiting mail arrived first (global arrival order), so a busy key cannot
 *   starve the others.
 * - Batch: when a key starts a turn, `options.batch ?? (p => p.slice(0, 1))`
 *   selects from that key's pending mails. The selection must be a non-empty
 *   in-order prefix of pending; anything else is a programming error and only
 *   the first mail is run. Selected mails leave the queue.
 * - `post` never starts a turn synchronously; turns start in a microtask.
 * - A runner rejection becomes `{status:'failed', content: message}`.
 *   `onTurnFinished` is awaited before the key (and its slot) is released;
 *   errors it throws are swallowed and reported through `onError`.
 * - `cancel` aborts a running batch's signal (a runner that resolves with a
 *   non-cancelled status after abort is reported as cancelled), or removes a
 *   queued mail and reports it cancelled.
 * - `close` rejects new posts, drops queued mails (reported cancelled), aborts
 *   running turns and resolves once everything has settled.
 */
import type {
  ActorTurnResult,
  Mail,
  MailId,
  Mailbox,
  MailboxKey,
  MailboxOptions,
  PostResult,
} from './contracts.js';

export interface MailboxLocalOptions {
  /** Receives swallowed errors from `onTurnFinished` and invalid batch selections. */
  readonly onError?: (error: unknown, context: string) => void;
}

interface Entry {
  readonly mail: Mail;
  readonly seq: number;
}

interface KeyState {
  readonly key: MailboxKey;
  pending: Entry[];
  running?: { batch: readonly Mail[]; controller: AbortController };
}

export function createMailbox(options: MailboxOptions, local: MailboxLocalOptions = {}): Mailbox {
  const policy = options.batch ?? ((p: readonly Mail[]) => p.slice(0, 1));
  const keys = new Map<string, KeyState>();
  const settling = new Set<Promise<void>>();
  const idleWaiters: Array<() => void> = [];
  let seq = 0;
  let runningCount = 0;
  let queuedCount = 0;
  let notifying = 0;
  let closed = false;
  let pumpScheduled = false;

  const report = (error: unknown, context: string): void => {
    try {
      local.onError?.(error, context);
    } catch {
      /* ignore */
    }
  };

  const keyId = (k: MailboxKey): string => `${k.actor}\u0000${k.engagementId}`;

  const checkIdle = (): void => {
    if (runningCount === 0 && queuedCount === 0 && notifying === 0) {
      for (const w of idleWaiters.splice(0)) w();
    }
  };

  const notify = async (key: MailboxKey, batch: readonly Mail[], result: ActorTurnResult): Promise<void> => {
    try {
      await options.onTurnFinished?.(key, batch, result);
    } catch (e) {
      report(e, 'onTurnFinished');
    }
  };

  const notifyDetached = (key: MailboxKey, batch: readonly Mail[], result: ActorTurnResult): void => {
    notifying++;
    const p: Promise<void> = notify(key, batch, result).finally(() => {
      notifying--;
      settling.delete(p);
      checkIdle();
    });
    settling.add(p);
  };

  const schedulePump = (): void => {
    if (pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(() => {
      pumpScheduled = false;
      pump();
    });
  };

  const pump = (): void => {
    while (!closed && runningCount < options.maxConcurrentTurns) {
      let best: KeyState | undefined;
      for (const st of keys.values()) {
        if (st.running || st.pending.length === 0) continue;
        if (!best || st.pending[0].seq < best.pending[0].seq) best = st;
      }
      if (!best) return;
      start(best);
    }
  };

  const start = (st: KeyState): void => {
    const pendingMails = st.pending.map((e) => e.mail);
    let selected: readonly Mail[];
    try {
      selected = policy(pendingMails);
    } catch (e) {
      report(e, 'batch');
      selected = [pendingMails[0]];
    }
    const valid =
      selected.length > 0 &&
      selected.length <= pendingMails.length &&
      selected.every((m, i) => m === pendingMails[i]);
    if (!valid) {
      report(new Error('invalid batch selection'), 'batch');
      selected = [pendingMails[0]];
    }
    const batch = selected.slice();
    st.pending.splice(0, batch.length);
    queuedCount -= batch.length;
    const controller = new AbortController();
    st.running = { batch, controller };
    runningCount++;

    const p: Promise<void> = (async () => {
      let result: ActorTurnResult;
      try {
        result = await options.run(st.key.actor, batch, controller.signal);
      } catch (e) {
        result = { status: 'failed', content: e instanceof Error ? e.message : String(e) };
      }
      if (controller.signal.aborted && result.status !== 'cancelled') {
        result = { status: 'cancelled', content: result.content };
      }
      await notify(st.key, batch, result);
    })().finally(() => {
      st.running = undefined;
      runningCount--;
      if (st.pending.length === 0) keys.delete(keyId(st.key));
      settling.delete(p);
      if (!closed) schedulePump();
      checkIdle();
    });
    settling.add(p);
  };

  return {
    post(mail: Mail): PostResult {
      if (closed) return { accepted: false, code: 'mailbox_closed', message: 'mailbox is closed' };
      const key: MailboxKey = { actor: mail.to, engagementId: mail.engagementId };
      const id = keyId(key);
      let st = keys.get(id);
      const waiting = st ? st.pending.length : 0;
      if (waiting >= options.maxQueuedPerKey) {
        return { accepted: false, code: 'queue_full', message: `queue full for ${mail.to} in ${mail.engagementId}` };
      }
      if (!st) {
        st = { key, pending: [] };
        keys.set(id, st);
      }
      st.pending.push({ mail, seq: seq++ });
      queuedCount++;
      schedulePump();
      return { accepted: true, position: st.pending.length };
    },

    cancel(mailId: MailId, reason?: string): boolean {
      for (const [id, st] of keys) {
        if (st.running?.batch.some((m) => m.id === mailId)) {
          st.running.controller.abort(reason ?? 'cancelled');
          return true;
        }
        const i = st.pending.findIndex((e) => e.mail.id === mailId);
        if (i >= 0) {
          const [removed] = st.pending.splice(i, 1);
          queuedCount--;
          if (st.pending.length === 0 && !st.running) keys.delete(id);
          notifyDetached(st.key, [removed.mail], { status: 'cancelled', content: reason });
          return true;
        }
      }
      return false;
    },

    idle(): Promise<void> {
      if (runningCount === 0 && queuedCount === 0 && notifying === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },

    async close(reason?: string): Promise<void> {
      closed = true;
      for (const [id, st] of [...keys]) {
        const dropped = st.pending.splice(0);
        queuedCount -= dropped.length;
        for (const e of dropped) {
          notifyDetached(st.key, [e.mail], { status: 'cancelled', content: reason });
        }
        if (st.running) st.running.controller.abort(reason ?? 'closed');
        else keys.delete(id);
      }
      while (settling.size > 0) await Promise.all([...settling]);
      checkIdle();
    },
  };
}
