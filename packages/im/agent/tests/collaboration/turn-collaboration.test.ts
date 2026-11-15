/**
 * #1250 batch 26: one conclusion per request. Unit tests of the per-engagement outcome ledger that decides
 * whether delegated results wake the entry actor, stay in the trace, or get one fixed line, and when a
 * guard stop must be told.
 */
import type { Mail } from '@zhin.js/harness';
import { createEngagementOutcomes } from '../../src/collaboration/turn-collaboration.js';

type Status = 'completed' | 'failed' | 'cancelled' | 'budget_exceeded' | 'denied';

function request(id: string, from: string, to: string, kind: 'ask' | 'delegate', causationId?: string): Mail {
  return {
    id, kind, to, engagementId: 'e1', grantId: 'g', createdAt: 0,
    from: { kind: 'actor', actor: from },
    ...(causationId ? { causationId } : {}),
    body: kind === 'ask' ? { kind: 'ask', question: 'q' } : { kind: 'delegate', brief: 'b' },
  } as unknown as Mail;
}

function result(inReplyTo: string, from: string, status: Status): Mail {
  return {
    id: `r-${inReplyTo}`, kind: 'result', to: 'zhin', engagementId: 'e1', grantId: 'g', createdAt: 0,
    from: { kind: 'actor', actor: from }, causationId: inReplyTo,
    body: { kind: 'result', inReplyTo, status, content: '' },
  } as unknown as Mail;
}

describe('engagement outcomes: delegated results', () => {
  it('runs a batch that carries any completed result', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.failuresTold([result('m0', 'draw', 'failed')]);
    expect(outcomes.plan([result('m1', 'draw', 'completed'), result('m2', 'draw', 'failed')])).toEqual({ kind: 'run' });
  });

  it('lets the first failure of a request wake the entry actor', () => {
    const outcomes = createEngagementOutcomes();
    expect(outcomes.plan([result('m3', 'draw', 'budget_exceeded')])).toEqual({ kind: 'run' });
  });

  it('withholds a failure that a completed follow-up on the same delegation superseded', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.recordSubTurn([request('m3', 'zhin', 'draw', 'delegate', 'm1')], 'budget_exceeded');
    outcomes.recordSubTurn([request('m5', 'zhin', 'draw', 'ask', 'm3')], 'completed');
    expect(outcomes.plan([result('m3', 'draw', 'budget_exceeded')])).toEqual({ kind: 'withhold', reason: 'superseded' });
  });

  it('follows a chain of follow-ups back to the delegation', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.recordSubTurn([request('m3', 'zhin', 'draw', 'delegate', 'm1')], 'budget_exceeded');
    outcomes.recordSubTurn([request('m5', 'zhin', 'draw', 'ask', 'm3')], 'failed');
    outcomes.recordSubTurn([request('m7', 'zhin', 'draw', 'ask', 'm5')], 'completed');
    expect(outcomes.plan([result('m3', 'draw', 'failed')])).toEqual({ kind: 'withhold', reason: 'superseded' });
  });

  it('does not count a later, separate ask or delegate to the same agent as superseding', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.recordSubTurn([request('m3', 'zhin', 'draw', 'delegate', 'm1')], 'budget_exceeded');
    // A new delegation (causation: the root mail) and a new ask, both completed.
    outcomes.recordSubTurn([request('m4', 'zhin', 'draw', 'delegate', 'm1')], 'completed');
    outcomes.recordSubTurn([request('m6', 'zhin', 'draw', 'ask', 'm1')], 'completed');
    expect(outcomes.plan([result('m3', 'draw', 'budget_exceeded')])).toEqual({ kind: 'run' });
  });

  it('does not treat a sub-agent\'s own ask as a follow-up of the mail it was processing', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.recordSubTurn([request('m3', 'zhin', 'alice', 'delegate', 'm1')], 'failed');
    // alice asked bob while processing m3: causation m3, but a different sender and target.
    outcomes.recordSubTurn([request('m4', 'alice', 'bob', 'ask', 'm3')], 'completed');
    expect(outcomes.plan([result('m3', 'alice', 'failed')])).toEqual({ kind: 'run' });
  });

  it('gives a later, different failure one fixed line instead of waking the entry actor again', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.failuresTold([result('m3', 'draw', 'budget_exceeded')]);
    expect(outcomes.plan([result('m4', 'draw', 'budget_exceeded'), result('m5', 'draw', 'failed')]))
      .toEqual({ kind: 'line', reason: 'another_failure', count: 2 });
    // Each delegation's failure is told once.
    expect(outcomes.plan([result('m4', 'draw', 'cancelled')])).toEqual({ kind: 'withhold', reason: 'superseded' });
  });

  it('does not count a failure as told until something was delivered', () => {
    const outcomes = createEngagementOutcomes();
    // The first failure-only batch ran, but its delivery failed: nothing was marked.
    expect(outcomes.plan([result('m3', 'draw', 'failed')])).toEqual({ kind: 'run' });
    expect(outcomes.plan([result('m4', 'draw', 'failed')])).toEqual({ kind: 'run' });
  });

  it('withholds failures after the guard stopped the request', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.entryStarted();
    outcomes.entryInformed();
    expect(outcomes.stopped()).toBe(false);
    expect(outcomes.entryFinished()).toBe(false);
    expect(outcomes.plan([result('m3', 'alice', 'cancelled')])).toEqual({ kind: 'withhold', reason: 'collaboration_stopped' });
  });
});

describe('engagement outcomes: guard stops', () => {
  it('tells a stop at once when no entry turn runs', () => {
    const outcomes = createEngagementOutcomes();
    expect(outcomes.stopped()).toBe(true);
    outcomes.stopAnnounced();
    expect(outcomes.stopped()).toBe(false);
  });

  it('defers a stop the running entry turn never saw to the end of that turn (B1)', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.entryStarted();
    expect(outcomes.stopped()).toBe(false);
    expect(outcomes.entryFinished()).toBe(true);
    outcomes.stopAnnounced();
    outcomes.entryStarted();
    expect(outcomes.entryFinished()).toBe(false);
  });

  it('says nothing more when the entry model met the stop itself', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.entryStarted();
    outcomes.stopped();
    outcomes.entryInformed();
    expect(outcomes.entryFinished()).toBe(false);
  });

  it('counts the stop line as the request\'s failure account', () => {
    const outcomes = createEngagementOutcomes();
    expect(outcomes.stopped()).toBe(true);
    outcomes.stopAnnounced();
    expect(outcomes.plan([result('m3', 'alice', 'cancelled')])).toEqual({ kind: 'withhold', reason: 'collaboration_stopped' });
  });
});
