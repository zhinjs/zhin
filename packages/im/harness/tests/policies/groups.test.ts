/** Pure inbox-policy helpers (ADR 0048 H3): grouping, windows, merged authority. */
import { describe, expect, it } from 'vitest';
import { laneOf, mailboxKeyOf, only, senderOf, type InboxEntry, type Mail } from '../../src/contracts.js';
import { classifyMail, groupInbox } from '../../src/policies/groups.js';
import { liveEvictions, liveWindowDueAt } from '../../src/policies/live.js';
import { inboxMarkers } from '../../src/policies/markers.js';
import { firstHumanPrincipal, mergedAuthority, mergeWindowDueAt, participantsOf, renderInboxText } from '../../src/policies/merge.js';
import { createInboxPolicy } from '../../src/policies/admission.js';
import { humanMail, type HumanFlags } from '../support/inbox-driver.js';

let n = 0;
const entry = (sender: string, text: string, flags: HumanFlags = {}, postedAt = 0, extra: Partial<InboxEntry> = {}): InboxEntry => {
  n += 1;
  return { mail: humanMail(n, sender, text, flags), seq: n, postedAt, ...extra };
};
const merge = { merge: { maxSenders: 2 }, live: true };
const shape = (entries: readonly InboxEntry[], options = merge) =>
  groupInbox(entries, options).map((g) => [g.kind, g.entries.map((e) => e.mail.body.kind === 'human' ? e.mail.body.text : '')]);

describe('contracts helpers', () => {
  it('derives lane, key and sender from the transport', () => {
    const mail = humanMail(1, 'alice', 'hi');
    expect(laneOf(mail)).toBe(mail.lane);
    expect(laneOf({ engagementId: 'e9' })).toBe('engagement:e9');
    expect(mailboxKeyOf(mail)).toEqual({ actor: 'zhin', lane: mail.lane, engagementId: 'e1' });
    expect(senderOf(mail)).toBe('alice');
    expect(senderOf({ from: { kind: 'actor', actor: 'reviewer' }, body: { kind: 'tell', content: 'x' } })).toBe('reviewer');
    expect(senderOf({ from: { kind: 'system', source: 'timer' }, body: { kind: 'timer', timerId: 't', content: 'x' } })).toBe('system:timer');
  });

  it('treats a bare human mail and non-human mail as unmarked', () => {
    const bare = { ...humanMail(1, 'alice', 'hi'), body: { kind: 'human', text: 'hi', venue: { kind: 'group', id: '1' } } } as Mail;
    expect(inboxMarkers(bare)).toMatchObject({ senderId: 'alice', plainText: false, mergeable: false, live: false, isStop: false });
    const tell = { ...bare, from: { kind: 'actor', actor: 'a' }, body: { kind: 'tell', content: 'yo' } } as Mail;
    expect(inboxMarkers(tell)).toMatchObject({ senderId: 'a', text: 'yo', human: false, plainText: false });
    expect(classifyMail(tell, merge)).toBe('single');
  });
});

describe('groupInbox', () => {
  it('coalesces a sender burst and keeps other senders apart', () => {
    expect(shape([entry('a', '1'), entry('b', '2'), entry('a', '3'), entry('a', '4', { plainText: false }), entry('a', '5')])).toEqual([
      ['single', ['1', '3']],
      ['single', ['2']],
      ['single', ['4']],
      ['single', ['5']],
    ]);
  });

  it('fills merge windows up to maxSenders, keeping bursts with their sender', () => {
    const m = { mergeable: true };
    expect(shape([entry('a', '1', m), entry('b', '2', m), entry('c', '3', m), entry('a', '4', m), entry('c', '5', m)])).toEqual([
      ['merge', ['1', '2', '4']],
      ['merge', ['3', '5']],
    ]);
  });

  it('collects every danmaku into one live group', () => {
    const l = { live: true };
    expect(shape([entry('a', '1', l), entry('x', 'single'), entry('b', '2', l)])).toEqual([
      ['live', ['1', '2']],
      ['single', ['single']],
    ]);
  });

  it('ignores markers whose window is disabled', () => {
    expect(shape([entry('a', '1', { mergeable: true }), entry('b', '2', { live: true })], {} as typeof merge)).toEqual([
      ['single', ['1']],
      ['single', ['2']],
    ]);
  });

  it('puts carried mails in front of their target group, past maxSenders', () => {
    const m = { mergeable: true };
    const target = entry('a', 'new', m, 10);
    const carried = [entry('a', 'old', m, 20, { carriedInto: target.mail.id }), entry('b', 'old-b', m, 20, { carriedInto: target.mail.id })];
    const c = entry('c', 'c', m, 11);
    const groups = groupInbox([...carried, target, c], merge);
    expect(groups.map((g) => [g.kind, g.senders])).toEqual([['merge', ['a', 'b', 'c']]]);
    // Window times come from the group's own mails, not the carried ones.
    expect([groups[0]!.openedAt, groups[0]!.lastJoinedAt]).toEqual([10, 11]);
    // A carried mail whose target left the queue answers on its own.
    expect(shape([entry('z', 'orphan', m, 0, { carriedInto: 'gone' })])).toEqual([['single', ['orphan']]]);
  });
});

describe('windows', () => {
  it('computes merge and live due times', () => {
    expect(mergeWindowDueAt({ openedAt: 0, lastJoinedAt: 1_000 }, { quietMs: 1_500, maxWaitMs: 6_000, maxSenders: 3 })).toBe(2_500);
    expect(mergeWindowDueAt({ openedAt: 0, lastJoinedAt: 5_000 }, { quietMs: 1_500, maxWaitMs: 6_000, maxSenders: 3 })).toBe(6_000);
    expect(liveWindowDueAt({ openedAt: 0 }, undefined, { windowMs: 10_000, minIntervalMs: 15_000 })).toBe(10_000);
    expect(liveWindowDueAt({ openedAt: 0 }, 5_000, { windowMs: 10_000, minIntervalMs: 15_000 })).toBe(20_000);
  });

  it('evicts the earliest sender\'s oldest danmaku first', () => {
    const es = [entry('a', '1', { live: true }), entry('b', '2', { live: true }), entry('a', '3', { live: true }), entry('c', '4', { live: true })];
    expect(liveEvictions(es, 2)).toEqual([es[0]!.mail.id, es[2]!.mail.id]);
    expect(liveEvictions(es, 4)).toEqual([]);
  });

  it('waits for the head window and runs single mails at once', () => {
    const policy = createInboxPolicy({ maxQueuedTurns: 5, supersedeSameSender: true, merge: { quietMs: 100, maxWaitMs: 1_000, maxSenders: 3 } });
    const w = entry('a', 'w', { mergeable: true }, 0);
    const s = entry('b', 's', {}, 0);
    const view = (now: number, pending: InboxEntry[]) => ({ key: { actor: 'zhin', lane: 'l', engagementId: 'e' }, now, pending });
    expect(policy.ready!(view(50, [w, s]))).toEqual({ kind: 'wait', until: 100 });
    expect(policy.ready!(view(100, [w, s]))).toEqual({ kind: 'run', batch: [w.mail] });
    expect(policy.ready!(view(0, [s, w]))).toEqual({ kind: 'run', batch: [s.mail] });
    expect(policy.ready!(view(0, []))).toEqual({ kind: 'wait' });
  });
});

describe('merged turn helpers (Q2)', () => {
  it('lists participants and renders one line per sender', () => {
    const batch = [entry('a', 'hi', { senderName: 'Alice' }).mail, entry('b', 'yo').mail, entry('a', 'again').mail];
    const ps = participantsOf(batch);
    expect(ps.map((p) => [p.senderId, p.texts])).toEqual([['a', ['hi', 'again']], ['b', ['yo']]]);
    expect(renderInboxText(ps)).toBe('Alice: hi\nagain\nb: yo');
    expect(renderInboxText(participantsOf([batch[0]!, batch[2]!]))).toBe('hi\nagain');
  });

  it('takes the first human as principal and intersects authorities', () => {
    const a = entry('a', '1').mail;
    const b = entry('b', '2').mail;
    const narrowB: Mail = {
      ...b,
      authority: { ...b.authority, trust: 'stranger', tools: only(['search']), egress: { network: true, hosts: only(['x.com']) } },
    };
    const wideA: Mail = { ...a, authority: { ...a.authority, trust: 'trusted', tools: only(['search', 'shell']), egress: { network: true, hosts: only(['x.com', 'y.com']) } } };
    const tell = { ...a, id: 'actor', from: { kind: 'actor', actor: 'helper' }, body: { kind: 'tell', content: 'x' } } as Mail;
    expect(firstHumanPrincipal([tell, wideA, narrowB])?.id).toBe('a');
    expect(firstHumanPrincipal([tell])).toBeUndefined();
    const merged = mergedAuthority([wideA, narrowB])!;
    expect(merged.principal.id).toBe('a');
    expect(merged.trust).toBe('stranger');
    expect(merged.tools).toEqual(only(['search']));
    expect(merged.egress).toEqual({ network: true, hosts: only(['x.com']) });
    expect(merged.approvers).toEqual(wideA.authority.approvers);
    expect(mergedAuthority([])).toBeUndefined();
  });
});
