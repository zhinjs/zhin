import {
  ALL,
  DEFAULT_GUARD_LIMITS,
  NONE,
  TRUST_LEVELS,
  only,
  scopeWithin,
  type AgentCeiling,
  type Authority,
  type Engagement,
  type GuardContext,
  type GuardLimits,
  type Mail,
  type MailBody,
  type MailSender,
  type Principal,
} from '../src/index.js';
import { createEngagementGraph, createGuardKernel } from '../src/guard.js';

// Tiny local attenuation stub: tools/contacts subset and trust not raised.
function isAttenuationOf(child: Authority, parent: Authority): boolean {
  return (
    scopeWithin(child.tools, parent.tools) &&
    scopeWithin(child.contacts, parent.contacts) &&
    TRUST_LEVELS.indexOf(child.trust) <= TRUST_LEVELS.indexOf(parent.trust)
  );
}

const kernel = createGuardKernel({ isAttenuationOf });

const principal: Principal = { kind: 'human', id: 'master', trust: 'master' };

function authority(overrides: Partial<Authority> = {}): Authority {
  return {
    principal,
    trust: 'master',
    tools: ALL,
    contacts: ALL,
    egress: { network: false, hosts: NONE },
    approvers: ['master'],
    chain: [],
    ...overrides,
  };
}

const AUTH = authority();

const engagement: Engagement = {
  id: 'e1',
  principal,
  rootMailId: 'root',
  rootGrantId: 'g0',
  openedAt: 0,
};

const human: MailSender = { kind: 'human', principal };
const actor = (id: string): MailSender => ({ kind: 'actor', actor: id });

function mail(id: string, from: MailSender, to: string, body: MailBody, causationId?: string, extra: Partial<Mail> = {}): Mail {
  return {
    id,
    kind: body.kind,
    engagementId: 'e1',
    causationId,
    from,
    to,
    authority: AUTH,
    grantId: 'g0',
    body,
    createdAt: 0,
    ...extra,
  };
}

const rootMail = mail('root', human, 'alice', { kind: 'human', text: 'hi', venue: { kind: 'group', id: 'g' } });

const ask = (question: string) => ({ kind: 'ask', question }) as const;

function ceiling(acceptsFrom = ALL): AgentCeiling {
  return {
    agent: 'x',
    tools: ALL,
    contacts: ALL,
    maxTrust: 'master',
    egress: { network: false, hosts: NONE },
    acceptsFrom,
  };
}

function ctx(mails: readonly Mail[], overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    graph: createEngagementGraph(engagement, mails),
    targetCeiling: ceiling(),
    senderAuthority: AUTH,
    limits: DEFAULT_GUARD_LIMITS,
    ...overrides,
  };
}

const LOOSE: GuardLimits = { maxDepth: 100, maxFanout: 100, maxPairRoundTrips: 100, maxDuplicates: 100 };

function denied(decision: ReturnType<typeof kernel.admitMail>) {
  if (decision.allow) throw new Error('expected denial');
  return decision;
}

describe('createEngagementGraph', () => {
  it('indexes mails by id and keeps admission order', () => {
    const a = mail('a', actor('alice'), 'bob', ask('q'), 'root');
    const graph = createEngagementGraph(engagement, [rootMail, a]);
    expect(graph.get('a')).toBe(a);
    expect(graph.get('nope')).toBeUndefined();
    expect(graph.mails.map((m) => m.id)).toEqual(['root', 'a']);
    expect(Object.isFrozen(graph)).toBe(true);
  });
});

describe('guard: engagement', () => {
  it('denies when the graph is missing', () => {
    const d = denied(kernel.admitMail(rootMail, ctx([], { graph: undefined })));
    expect(d.code).toBe('unknown_engagement');
    expect(d.escalate).toBe(false);
  });

  it('denies a mail for another engagement', () => {
    const d = denied(kernel.admitMail({ ...rootMail, engagementId: 'e2' }, ctx([])));
    expect(d.code).toBe('unknown_engagement');
    expect(d.reason).toContain('e2');
  });
});

describe('guard: causation', () => {
  it('admits the root mail without causation', () => {
    expect(kernel.admitMail(rootMail, ctx([])).allow).toBe(true);
  });

  it('denies a non-root mail without causation', () => {
    const m = mail('m1', actor('alice'), 'bob', ask('q'));
    const d = denied(kernel.admitMail(m, ctx([rootMail])));
    expect(d.code).toBe('missing_causation');
    expect(d.escalate).toBe(false);
  });

  it('denies an unknown causation id', () => {
    const m = mail('m1', actor('alice'), 'bob', ask('q'), 'ghost');
    expect(denied(kernel.admitMail(m, ctx([rootMail]))).code).toBe('missing_causation');
  });

  it('admits a mail whose causation is in the graph', () => {
    const m = mail('m1', actor('alice'), 'bob', ask('q'), 'root');
    expect(kernel.admitMail(m, ctx([rootMail])).allow).toBe(true);
  });
});

describe('guard: authority attenuation', () => {
  it('denies an actor mail without sender authority', () => {
    const m = mail('m1', actor('alice'), 'bob', ask('q'), 'root');
    const d = denied(kernel.admitMail(m, ctx([rootMail], { senderAuthority: undefined })));
    expect(d.code).toBe('authority_not_attenuated');
    expect(d.escalate).toBe(false);
  });

  it('denies an actor mail carrying wider authority than the sender', () => {
    const m = mail('m1', actor('alice'), 'bob', ask('q'), 'root');
    const narrow = authority({ tools: only(['read']) });
    const d = denied(kernel.admitMail(m, ctx([rootMail], { senderAuthority: narrow })));
    expect(d.code).toBe('authority_not_attenuated');
    expect(d.reason).toContain('alice');
  });

  it('admits an attenuated authority', () => {
    const m = mail('m1', actor('alice'), 'bob', ask('q'), 'root', { authority: authority({ tools: only(['read']) }) });
    expect(kernel.admitMail(m, ctx([rootMail])).allow).toBe(true);
  });

  it('does not check attenuation for human mails', () => {
    expect(kernel.admitMail(rootMail, ctx([], { senderAuthority: undefined })).allow).toBe(true);
  });
});

describe('guard: results', () => {
  const askBob = mail('a1', actor('alice'), 'bob', ask('q'), 'root');

  it('admits a result back to the asker without checking authority', () => {
    const r = mail('r1', actor('bob'), 'alice', { kind: 'result', inReplyTo: 'a1', status: 'completed', content: 'ok' }, 'a1', {
      authority: authority({ tools: ALL }),
    });
    const narrow = authority({ tools: NONE, contacts: NONE });
    expect(kernel.admitMail(r, ctx([rootMail, askBob], { senderAuthority: narrow })).allow).toBe(true);
  });

  it('admits a result to the root actor for a human-originated ask', () => {
    // A human/system mail of kind ask addressed to carol, answered back to the root actor.
    const sysAsk = mail('s1', { kind: 'system', source: 'harness' }, 'carol', ask('q'), 'root');
    const r = mail('r1', actor('carol'), 'alice', { kind: 'result', inReplyTo: 's1', status: 'completed', content: 'ok' }, 's1');
    expect(kernel.admitMail(r, ctx([rootMail, sysAsk])).allow).toBe(true);
  });

  it('denies a forged result replying to someone else\'s ask', () => {
    const askCarol = mail('a2', actor('alice'), 'carol', ask('q2'), 'root');
    const forged = mail('r1', actor('bob'), 'alice', { kind: 'result', inReplyTo: 'a2', status: 'completed', content: 'fake' }, 'a2');
    const d = denied(kernel.admitMail(forged, ctx([rootMail, askBob, askCarol])));
    expect(d.code).toBe('missing_causation');
    expect(d.reason).toContain('carol');
  });

  it('denies a result sent to someone other than the asker', () => {
    const r = mail('r1', actor('bob'), 'mallory', { kind: 'result', inReplyTo: 'a1', status: 'completed', content: 'x' }, 'a1');
    expect(denied(kernel.admitMail(r, ctx([rootMail, askBob]))).code).toBe('missing_causation');
  });

  it('denies a result replying to an unknown or non-ask mail', () => {
    const unknown = mail('r1', actor('bob'), 'alice', { kind: 'result', inReplyTo: 'zz', status: 'completed', content: 'x' }, 'a1');
    expect(denied(kernel.admitMail(unknown, ctx([rootMail, askBob]))).code).toBe('missing_causation');
    const tell = mail('t1', actor('alice'), 'bob', { kind: 'tell', content: 'fyi' }, 'root');
    const r = mail('r2', actor('bob'), 'alice', { kind: 'result', inReplyTo: 't1', status: 'completed', content: 'x' }, 't1');
    expect(denied(kernel.admitMail(r, ctx([rootMail, tell]))).code).toBe('missing_causation');
  });

  it('checks signal targets structurally', () => {
    const ok = mail('s1', actor('alice'), 'bob', { kind: 'signal', signal: 'cancel', target: 'a1' }, 'a1');
    expect(kernel.admitMail(ok, ctx([rootMail, askBob], { senderAuthority: undefined })).allow).toBe(true);
    const bad = mail('s2', actor('alice'), 'bob', { kind: 'signal', signal: 'cancel', target: 'zz' }, 'a1');
    expect(denied(kernel.admitMail(bad, ctx([rootMail, askBob]))).code).toBe('missing_causation');
  });
});

describe('guard: contacts and acceptance', () => {
  it('denies a target outside the sender contacts', () => {
    const m = mail('m1', actor('alice'), 'bob#1', ask('q'), 'root', { authority: authority({ contacts: only(['carol']) }) });
    const d = denied(kernel.admitMail(m, ctx([rootMail], { senderAuthority: authority({ contacts: only(['carol']) }) })));
    expect(d.code).toBe('contact_not_allowed');
    expect(d.escalate).toBe(false);
    expect(d.reason).toContain('bob');
  });

  it('matches contacts by agent name, ignoring the instance', () => {
    const auth = authority({ contacts: only(['bob']) });
    const m = mail('m1', actor('alice'), 'bob#7', ask('q'), 'root', { authority: auth });
    expect(kernel.admitMail(m, ctx([rootMail], { senderAuthority: auth })).allow).toBe(true);
  });

  it('denies when the target does not accept the sender agent', () => {
    const m = mail('m1', actor('alice#3'), 'bob', { kind: 'tell', content: 'fyi' }, 'root');
    const d = denied(kernel.admitMail(m, ctx([rootMail], { targetCeiling: ceiling(only(['carol'])) })));
    expect(d.code).toBe('not_accepted_by_target');
    expect(d.reason).toContain('alice');
  });

  it('applies acceptance to human mails', () => {
    expect(denied(kernel.admitMail(rootMail, ctx([], { targetCeiling: ceiling(only(['alice'])) }))).code).toBe(
      'not_accepted_by_target',
    );
    expect(kernel.admitMail(rootMail, ctx([], { targetCeiling: ceiling(only(['human'])) })).allow).toBe(true);
  });
});

describe('guard: convergence limits', () => {
  function chain(n: number): Mail[] {
    // root → alice; alice asks a1, a1 asks a2, ...
    const mails: Mail[] = [rootMail];
    let prev = 'root';
    let sender = 'alice';
    for (let i = 1; i <= n; i += 1) {
      const m = mail(`h${i}`, actor(sender), `agent${i}`, ask(`q${i}`), prev);
      mails.push(m);
      prev = m.id;
      sender = `agent${i}`;
    }
    return mails;
  }

  it('allows depth up to the limit and denies beyond it', () => {
    const limits = { ...LOOSE, maxDepth: 2 };
    const two = chain(2);
    const ok = mail('x', actor('agent1'), 'agent2', ask('q2'), 'h1');
    expect(kernel.admitMail(ok, ctx(chain(1), { limits })).allow).toBe(true);
    const over = mail('x', actor('agent2'), 'agent3', ask('q3'), 'h2');
    const d = denied(kernel.admitMail(over, ctx(two, { limits })));
    expect(d.code).toBe('depth_exceeded');
    expect(d.escalate).toBe(true);
    expect(d.reason).toContain('2');
  });

  it('does not count tells or results as depth hops', () => {
    const limits = { ...LOOSE, maxDepth: 1 };
    const tell = mail('t1', actor('alice'), 'bob', { kind: 'tell', content: 'fyi' }, 'root');
    const m = mail('x', actor('bob'), 'carol', ask('q'), 't1');
    expect(kernel.admitMail(m, ctx([rootMail, tell], { limits })).allow).toBe(true);
  });

  it('denies fanout above the limit', () => {
    const limits = { ...LOOSE, maxFanout: 2 };
    const a = mail('a', actor('alice'), 'bob', ask('1'), 'root');
    const b = mail('b', actor('alice'), 'carol', ask('2'), 'root');
    const c = mail('c', actor('alice'), 'dave', ask('3'), 'root');
    expect(kernel.admitMail(b, ctx([rootMail, a], { limits })).allow).toBe(true);
    const d = denied(kernel.admitMail(c, ctx([rootMail, a, b], { limits })));
    expect(d.code).toBe('fanout_exceeded');
    expect(d.escalate).toBe(true);
    // tells do not count against fanout
    const tell = mail('t', actor('alice'), 'dave', { kind: 'tell', content: 'fyi' }, 'root');
    expect(kernel.admitMail(tell, ctx([rootMail, a, b], { limits })).allow).toBe(true);
  });

  it('denies pair round trips in either direction above the limit', () => {
    const limits = { ...LOOSE, maxPairRoundTrips: 2 };
    const a = mail('a', actor('alice'), 'bob', ask('1'), 'root');
    const b = mail('b', actor('bob'), 'alice', ask('2'), 'a');
    const c = mail('c', actor('alice'), 'bob', ask('3'), 'b');
    expect(kernel.admitMail(b, ctx([rootMail, a], { limits })).allow).toBe(true);
    const d = denied(kernel.admitMail(c, ctx([rootMail, a, b], { limits })));
    expect(d.code).toBe('pair_round_trips_exceeded');
    expect(d.escalate).toBe(true);
    expect(d.reason).toMatch(/alice.*bob/);
    // a different pair is unaffected
    const e = mail('e', actor('alice'), 'carol', ask('4'), 'b');
    expect(kernel.admitMail(e, ctx([rootMail, a, b], { limits })).allow).toBe(true);
  });

  it('denies duplicates by normalized content', () => {
    const limits = { ...LOOSE, maxDuplicates: 1 };
    const a = mail('a', actor('alice'), 'bob', { kind: 'tell', content: 'Ship  it\n now' }, 'root');
    const dup = mail('b', actor('alice'), 'bob', { kind: 'tell', content: '  ship it NOW ' }, 'root');
    const d = denied(kernel.admitMail(dup, ctx([rootMail, a], { limits })));
    expect(d.code).toBe('duplicate_mail');
    expect(d.escalate).toBe(true);
    // different target, kind or content is not a duplicate
    expect(kernel.admitMail({ ...dup, to: 'carol' }, ctx([rootMail, a], { limits })).allow).toBe(true);
    const asked = mail('c', actor('alice'), 'bob', ask('ship it now'), 'root');
    expect(kernel.admitMail(asked, ctx([rootMail, a], { limits })).allow).toBe(true);
    const other = mail('d', actor('alice'), 'bob', { kind: 'tell', content: 'wait' }, 'root');
    expect(kernel.admitMail(other, ctx([rootMail, a], { limits })).allow).toBe(true);
  });
});

describe('guard: rule ordering', () => {
  it('reports causation before authority', () => {
    const m = mail('m1', actor('alice'), 'bob', ask('q'), 'ghost');
    expect(denied(kernel.admitMail(m, ctx([rootMail], { senderAuthority: undefined }))).code).toBe('missing_causation');
  });

  it('reports authority before contacts', () => {
    const narrow = authority({ tools: NONE, contacts: NONE });
    const m = mail('m1', actor('alice'), 'bob', ask('q'), 'root');
    expect(denied(kernel.admitMail(m, ctx([rootMail], { senderAuthority: narrow }))).code).toBe('authority_not_attenuated');
  });

  it('reports contacts before acceptance and limits', () => {
    const auth = authority({ contacts: only(['carol']) });
    const m = mail('m1', actor('alice'), 'bob', ask('q'), 'root', { authority: auth });
    const d = kernel.admitMail(m, ctx([rootMail], {
      senderAuthority: auth,
      targetCeiling: ceiling(NONE),
      limits: { maxDepth: 0, maxFanout: 0, maxPairRoundTrips: 0, maxDuplicates: 0 },
    }));
    expect(denied(d).code).toBe('contact_not_allowed');
  });

  it('reports depth before fanout, pair and duplicates', () => {
    const m = mail('m1', actor('alice'), 'bob', ask('q'), 'root');
    const limits = { maxDepth: 0, maxFanout: 0, maxPairRoundTrips: 0, maxDuplicates: 0 };
    expect(denied(kernel.admitMail(m, ctx([rootMail], { limits }))).code).toBe('depth_exceeded');
    expect(denied(kernel.admitMail(m, ctx([rootMail], { limits: { ...limits, maxDepth: 9 } }))).code).toBe('fanout_exceeded');
    expect(
      denied(kernel.admitMail(m, ctx([rootMail], { limits: { ...limits, maxDepth: 9, maxFanout: 9 } }))).code,
    ).toBe('pair_round_trips_exceeded');
    expect(
      denied(kernel.admitMail(m, ctx([rootMail], { limits: { ...LOOSE, maxDuplicates: 0 } }))).code,
    ).toBe('duplicate_mail');
  });
});

describe('guard: ping-pong scenario (harness-ping-pong-escalates)', () => {
  it('stops alice and bob bouncing the same question within limits and escalates', () => {
    const aliceAuth = authority({ contacts: only(['bob']) });
    const bobAuth = authority({ contacts: only(['alice']) });
    const mails: Mail[] = [rootMail];
    expect(kernel.admitMail(rootMail, ctx([])).allow).toBe(true);

    let prev = 'root';
    let decision: ReturnType<typeof kernel.admitMail> = { allow: true };
    let admittedAsks = 0;
    // The eval script has 8 asks; the guard must stop before running it out.
    for (let i = 0; i < 8; i += 1) {
      const from = i % 2 === 0 ? 'alice' : 'bob';
      const to = from === 'alice' ? 'bob' : 'alice';
      const auth = from === 'alice' ? aliceAuth : bobAuth;
      const m = mail(`p${i}`, actor(from), to, ask('Who should own this?'), prev, { authority: auth });
      decision = kernel.admitMail(m, ctx(mails, { senderAuthority: auth, targetCeiling: ceiling(only([from])) }));
      if (!decision.allow) break;
      mails.push(m);
      prev = m.id;
      admittedAsks += 1;
    }

    const d = denied(decision);
    expect(d.escalate).toBe(true);
    expect(admittedAsks).toBeLessThanOrEqual(DEFAULT_GUARD_LIMITS.maxPairRoundTrips);
    expect(d.code).toBe('pair_round_trips_exceeded');
    expect(d.reason).toContain('alice');
    expect(d.reason).toContain('bob');
  });
});
