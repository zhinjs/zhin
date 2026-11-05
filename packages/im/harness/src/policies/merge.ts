/**
 * Merge window (ADR 0038 §1) as an inbox policy part, plus the helpers a
 * merged turn needs (ADR 0048 H3, Q2).
 *
 * A merge group is answered once it went quiet for `quietMs` or, at the
 * latest, `maxWaitMs` after it opened. Q2 (accepted): a merged batch runs in
 * its first mail's engagement; its principal is the first human sender; its
 * authority is the intersection of every sender's authority. These helpers
 * are exposed now; wiring them into the IM turn is PR-2.
 */
import { intersectScopes, type Authority, type Mail, type Principal } from '../contracts.js';
import { minTrust } from '../authority.js';
import type { InboxGroup } from './groups.js';
import { inboxMarkers } from './markers.js';

export interface MergeWindowOptions {
  /** Flush once no new mail joined the window for this long. */
  readonly quietMs: number;
  /** Flush at the latest this long after the window opened. */
  readonly maxWaitMs: number;
  /** Senders one window may hold; further senders open the next window. */
  readonly maxSenders: number;
}

export function normalizeMergeWindow(options: MergeWindowOptions): MergeWindowOptions {
  return Object.freeze({
    quietMs: Math.max(0, options.quietMs),
    maxWaitMs: Math.max(0, options.maxWaitMs),
    maxSenders: Math.max(1, Math.floor(options.maxSenders)),
  });
}

/** When a merge group may be answered. */
export function mergeWindowDueAt(group: Pick<InboxGroup, 'openedAt' | 'lastJoinedAt'>, options: MergeWindowOptions): number {
  return Math.min(group.lastJoinedAt + options.quietMs, group.openedAt + options.maxWaitMs);
}

/** One sender's mails in a batch, in arrival order. */
export interface InboxParticipant {
  readonly senderId: string;
  readonly senderName?: string;
  readonly texts: readonly string[];
  /** Platform message ids behind `texts`, when known. */
  readonly messageIds?: readonly string[];
  readonly mails: readonly Mail[];
}

/** Groups a batch by sender, senders in order of their first mail. */
export function participantsOf(batch: readonly Mail[]): readonly InboxParticipant[] {
  const order: string[] = [];
  const by = new Map<string, { senderName?: string; texts: string[]; messageIds: string[]; mails: Mail[] }>();
  for (const mail of batch) {
    const m = inboxMarkers(mail);
    let p = by.get(m.senderId);
    if (!p) {
      p = { ...(m.senderName ? { senderName: m.senderName } : {}), texts: [], messageIds: [], mails: [] };
      by.set(m.senderId, p);
      order.push(m.senderId);
    }
    if (!p.senderName && m.senderName) p.senderName = m.senderName;
    p.texts.push(m.text);
    if (m.messageId) p.messageIds.push(m.messageId);
    p.mails.push(mail);
  }
  return Object.freeze(order.map((senderId) => {
    const p = by.get(senderId)!;
    return Object.freeze({
      senderId,
      ...(p.senderName ? { senderName: p.senderName } : {}),
      texts: Object.freeze(p.texts),
      ...(p.messageIds.length > 0 ? { messageIds: Object.freeze(p.messageIds) } : {}),
      mails: Object.freeze(p.mails),
    });
  }));
}

/**
 * One sender: their texts joined by newlines. Several senders: one
 * `name: text` line per sender so the model can tell who asked what.
 */
export function renderInboxText(participants: readonly InboxParticipant[]): string {
  const lines = (p: InboxParticipant) => p.texts.filter((text) => text.trim());
  if (participants.length === 1) return lines(participants[0]!).join('\n');
  return participants
    .map((p) => ({ name: p.senderName?.trim() || p.senderId, texts: lines(p) }))
    .filter((p) => p.texts.length > 0)
    .map((p) => `${p.name}: ${p.texts.join('\n')}`)
    .join('\n');
}

/** Q2: the principal of a merged batch is its first human sender. */
export function firstHumanPrincipal(batch: readonly Mail[]): Principal | undefined {
  for (const mail of batch) if (mail.from.kind === 'human') return mail.from.principal;
  return undefined;
}

/**
 * Q2: the authority of a merged batch is the intersection of its mails'
 * authorities (trust = lowest, tools / contacts / egress hosts = common,
 * network only when everyone has it). Principal, approvers and chain stay
 * those of the first human mail (approvals go to that principal), so the
 * result never exceeds any sender's authority.
 */
export function mergedAuthority(batch: readonly Mail[]): Authority | undefined {
  if (batch.length === 0) return undefined;
  const lead = batch.find((mail) => mail.from.kind === 'human') ?? batch[0]!;
  const all = batch.map((mail) => mail.authority);
  const base = lead.authority;
  return Object.freeze({
    principal: base.principal,
    trust: minTrust(...all.map((a) => a.trust)),
    tools: all.reduce((scope, a) => intersectScopes(scope, a.tools), base.tools),
    contacts: all.reduce((scope, a) => intersectScopes(scope, a.contacts), base.contacts),
    egress: Object.freeze({
      network: all.every((a) => a.egress.network),
      hosts: all.reduce((scope, a) => intersectScopes(scope, a.egress.hosts), base.egress.hosts),
    }),
    approvers: base.approvers,
    chain: base.chain,
  });
}
