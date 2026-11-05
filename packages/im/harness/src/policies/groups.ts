/**
 * Turn groups of a lane's queue (ADR 0048 H3; semantics of the former
 * `TurnAdmissionGate`, ADR 0038 §1/§5 and #725).
 *
 * The queue holds single mails; a group is the set of queued mails one turn
 * will answer. Groups are recomputed from the queue on every decision, so
 * the policy stays pure. Replaying the queue in order:
 *
 * - **live** (danmaku, when enabled): joins the lane's last live group, no
 *   sender limit.
 * - **merge** (mergeable plain text, when a merge window is enabled): joins
 *   the last merge group that already has the sender (burst), else the last
 *   merge group with fewer than `maxSenders` senders, else opens a new one.
 * - **single** (everything else): joins the sender's own queued group when
 *   that is a single plain-text group and this mail is plain text too
 *   (burst coalescing); otherwise opens a new group. A member never joins
 *   another member's single group.
 * - Mails requeued by a stale discard (`carriedInto`) belong to the group of
 *   their target mail, ahead of it, regardless of `maxSenders`; when the
 *   target left the queue they form their own group.
 *
 * Groups are ordered by their first mail in the queue; the head group always
 * contains the queue's first mail.
 */
import type { InboxEntry, Mail, MailId } from '../contracts.js';
import { inboxMarkers } from './markers.js';

export type InboxGroupKind = 'single' | 'merge' | 'live';

export interface InboxGroup {
  readonly kind: InboxGroupKind;
  /** In queue order. */
  readonly entries: readonly InboxEntry[];
  /** Distinct senders in queue order. */
  readonly senders: readonly string[];
  readonly plainText: boolean;
  /** Earliest / latest (re)queue time of the group's own (not carried) mails. */
  readonly openedAt: number;
  readonly lastJoinedAt: number;
}

export interface InboxGroupingOptions {
  /** Merge windows enabled; omitted = mergeable is ignored. */
  readonly merge?: { readonly maxSenders: number };
  /** Danmaku windows enabled. */
  readonly live?: boolean;
}

export function classifyMail(mail: Mail, options: InboxGroupingOptions): InboxGroupKind {
  const m = inboxMarkers(mail);
  if (options.live && m.live) return 'live';
  if (options.merge && m.mergeable && m.plainText) return 'merge';
  return 'single';
}

interface Draft {
  readonly kind: InboxGroupKind;
  readonly own: Set<string>;
  plainText: boolean;
}

export function groupInbox(entries: readonly InboxEntry[], options: InboxGroupingOptions): InboxGroup[] {
  const maxSenders = Math.max(1, Math.floor(options.merge?.maxSenders ?? 1));
  const drafts: Draft[] = [];
  const draftOf = new Map<InboxEntry, Draft>();
  const byMail = new Map<MailId, Draft>();
  const findLast = (predicate: (d: Draft) => boolean): Draft | undefined => {
    for (let i = drafts.length - 1; i >= 0; i -= 1) if (predicate(drafts[i]!)) return drafts[i];
    return undefined;
  };
  const open = (kind: InboxGroupKind, plainText: boolean): Draft => {
    const d: Draft = { kind, own: new Set(), plainText };
    drafts.push(d);
    return d;
  };

  for (const entry of entries) {
    if (entry.carriedInto !== undefined) continue;
    const m = inboxMarkers(entry.mail);
    const kind = classifyMail(entry.mail, options);
    let d: Draft;
    if (kind === 'live') {
      d = findLast((g) => g.kind === 'live') ?? open('live', true);
    } else if (kind === 'merge') {
      d = findLast((g) => g.kind === 'merge' && g.own.has(m.senderId))
        ?? findLast((g) => g.kind === 'merge' && g.own.size < maxSenders)
        ?? open('merge', true);
    } else {
      const own = findLast((g) => g.own.has(m.senderId));
      d = own && own.kind === 'single' && own.plainText && m.plainText ? own : open('single', m.plainText);
    }
    d.own.add(m.senderId);
    draftOf.set(entry, d);
    byMail.set(entry.mail.id, d);
  }
  for (const entry of entries) {
    if (entry.carriedInto === undefined) continue;
    const target = byMail.get(entry.carriedInto);
    if (target) {
      draftOf.set(entry, target);
    } else {
      const d: Draft = { kind: 'single', own: new Set([inboxMarkers(entry.mail).senderId]), plainText: inboxMarkers(entry.mail).plainText };
      draftOf.set(entry, d);
    }
  }

  const order: Draft[] = [];
  const members = new Map<Draft, InboxEntry[]>();
  for (const entry of entries) {
    const d = draftOf.get(entry)!;
    let list = members.get(d);
    if (!list) {
      list = [];
      members.set(d, list);
      order.push(d);
    }
    list.push(entry);
  }
  return order.map((d) => {
    const list = members.get(d)!;
    const own = list.filter((e) => e.carriedInto === undefined);
    const times = (own.length > 0 ? own : list).map((e) => e.postedAt);
    const senders: string[] = [];
    for (const e of list) {
      const s = inboxMarkers(e.mail).senderId;
      if (!senders.includes(s)) senders.push(s);
    }
    return Object.freeze({
      kind: d.kind,
      entries: Object.freeze(list),
      senders: Object.freeze(senders),
      plainText: d.plainText,
      openedAt: Math.min(...times),
      lastJoinedAt: Math.max(...times),
    });
  });
}
