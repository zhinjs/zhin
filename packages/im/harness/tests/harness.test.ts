import {
  ALL,
  DEFAULT_GUARD_LIMITS,
  InMemoryBudgetLedger,
  InMemoryEngagementJournal,
  attenuate,
  createGuardKernel,
  createHarness,
  createMailbox,
  isAttenuationOf,
  only,
  rootAuthority,
  type ActorTurnResult,
  type AgentCeiling,
  type BudgetAmounts,
  type EscalationNotice,
  type Harness,
  type Mail,
  type NameScope,
  type Principal,
} from '../src/index.js';

type Behaviour = (mail: Mail, harness: Harness) => Promise<ActorTurnResult>;

const master: Principal = { kind: 'human', id: 'owner', trust: 'master', venue: { kind: 'private', id: 'owner' } };
const member: Principal = { kind: 'human', id: 'mallory', trust: 'group_member', venue: { kind: 'group', id: 'g1' } };
const BUDGET: BudgetAmounts = { modelCalls: 20, tokens: 100_000, wallMs: 60_000, sideEffects: 10 };

function ceiling(agent: string, tools: NameScope, contacts: NameScope = ALL, acceptsFrom: NameScope = ALL): AgentCeiling {
  return { agent, tools, contacts, maxTrust: 'master', egress: { network: false, hosts: ALL }, acceptsFrom };
}

function setup(ceilings: AgentCeiling[], behaviours: Record<string, Behaviour>) {
  const journal = new InMemoryEngagementJournal();
  const escalations: EscalationNotice[] = [];
  const seen: Array<{ actor: string; mails: Mail[] }> = [];
  const byAgent = new Map(ceilings.map((c) => [c.agent, c]));
  let ids = 0;
  const harness: Harness = createHarness({
    guard: createGuardKernel({ isAttenuationOf }),
    ledger: new InMemoryBudgetLedger(),
    journal,
    createMailbox: (options) => createMailbox(options),
    ceilingOf: (agent) => byAgent.get(agent),
    rootAuthority,
    attenuate,
    newId: () => `id${++ids}`,
    clock: () => 1000,
    limits: DEFAULT_GUARD_LIMITS,
    onEscalate: (notice) => { escalations.push(notice); },
    runTurn: async (actor, batch) => {
      seen.push({ actor, mails: [...batch] });
      const behaviour = behaviours[actor];
      if (!behaviour) return { status: 'completed', content: `${actor} done` };
      return behaviour(batch[0]!, harness);
    },
  });
  return { harness, journal, escalations, seen };
}

async function eventTypes(journal: InMemoryEngagementJournal, engagementId: string): Promise<string[]> {
  return (await journal.read(engagementId)).map((event) => event.type);
}

const humanBody = (text: string) => ({ kind: 'human' as const, text, venue: { kind: 'private', id: 'owner' } });

describe('harness: engagement lifecycle', () => {
  it('runs the root turn, journals it and closes the engagement', async () => {
    const { harness, journal, seen } = setup([ceiling('zhin', ALL)], {});
    const opened = await harness.open({ principal: master, entry: 'zhin', body: humanBody('hi'), budget: BUDGET });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await harness.idle();
    expect(seen.map((turn) => turn.actor)).toEqual(['zhin']);
    expect(await eventTypes(journal, opened.engagement.id)).toEqual([
      'engagement_opened', 'mail_admitted', 'turn_started', 'turn_finished', 'engagement_closed',
    ]);
    expect(harness.engagement(opened.engagement.id)).toBeUndefined();
  });

  it('refuses an unknown entry agent', async () => {
    const { harness } = setup([], {});
    const opened = await harness.open({ principal: master, entry: 'ghost', body: humanBody('hi'), budget: BUDGET });
    expect(opened).toMatchObject({ ok: false, code: 'unknown_agent' });
  });

  it('refuses a human the entry agent does not accept', async () => {
    const { harness } = setup([ceiling('ops', ALL, ALL, only(['zhin']))], {});
    const opened = await harness.open({ principal: master, entry: 'ops', body: humanBody('hi'), budget: BUDGET });
    expect(opened).toMatchObject({ ok: false, code: 'not_accepted_by_target' });
  });
});

describe('harness: collaboration', () => {
  it('ask resolves with the target reply inside the asker turn and is not re-posted', async () => {
    let reply: unknown;
    const { harness, journal, seen } = setup([ceiling('zhin', ALL), ceiling('researcher', only(['lookup']))], {
      zhin: async (mail, h) => {
        const outcome = await h.send('zhin', mail, { kind: 'ask', to: 'researcher', text: 'When is LTS?' });
        reply = outcome.ok ? outcome.reply : outcome;
        return { status: 'completed', content: 'answered' };
      },
      researcher: async () => ({ status: 'completed', content: 'October' }),
    });
    const opened = await harness.open({ principal: master, entry: 'zhin', body: humanBody('ask'), budget: BUDGET });
    if (!opened.ok) throw new Error('open failed');
    await harness.idle();
    expect(reply).toEqual({ status: 'completed', content: 'October' });
    expect(seen.map((turn) => turn.actor)).toEqual(['zhin', 'researcher']);
    const types = await eventTypes(journal, opened.engagement.id);
    expect(types.filter((type) => type === 'mail_admitted')).toHaveLength(3); // root, ask, result
    expect(types.at(-1)).toBe('engagement_closed');
  });

  it('delegate posts the result back to the delegator as a new turn', async () => {
    const { harness, seen } = setup([ceiling('zhin', ALL), ceiling('researcher', only(['lookup']))], {
      zhin: async (mail, h) => {
        if (mail.body.kind === 'result') return { status: 'completed', content: `relayed: ${mail.body.content}` };
        const outcome = await h.send('zhin', mail, { kind: 'delegate', to: 'researcher', text: 'Find it.' });
        expect(outcome.ok).toBe(true);
        return { status: 'completed', content: 'delegated' };
      },
      researcher: async () => ({ status: 'completed', content: 'found' }),
    });
    await harness.open({ principal: master, entry: 'zhin', body: humanBody('go'), budget: BUDGET });
    await harness.idle();
    expect(seen.map((turn) => `${turn.actor}:${turn.mails[0]!.kind}`)).toEqual(['zhin:human', 'researcher:delegate', 'zhin:result']);
    const result = seen[2]!.mails[0]!;
    expect(result.body).toMatchObject({ kind: 'result', status: 'completed', content: 'found' });
    expect(result.from).toEqual({ kind: 'actor', actor: 'researcher' });
  });

  it('attenuates authority: a group member delegation never carries the delegatee shell', async () => {
    let delegated: Mail | undefined;
    const { harness } = setup([ceiling('zhin', only(['lookup'])), ceiling('ops', only(['bash', 'lookup']))], {
      zhin: async (mail, h) => {
        const outcome = await h.send('zhin', mail, { kind: 'delegate', to: 'ops', text: 'clear cache', narrowing: { tools: ALL } });
        if (outcome.ok) delegated = outcome.mail;
        return { status: 'completed' };
      },
    });
    await harness.open({ principal: member, entry: 'zhin', body: humanBody('clear'), budget: BUDGET });
    await harness.idle();
    expect(delegated?.authority.tools).toEqual(only(['lookup']));
    expect(delegated?.authority.trust).toBe('group_member');
    expect(delegated?.authority.chain).toEqual(['zhin']);
    expect(delegated?.authority.approvers).toEqual(['mallory']);
  });

  it('denies contacting an agent outside the contacts list without running it', async () => {
    let outcome: unknown;
    const { harness, seen } = setup([ceiling('zhin', ALL, only(['researcher'])), ceiling('ops', ALL)], {
      zhin: async (mail, h) => {
        outcome = await h.send('zhin', mail, { kind: 'delegate', to: 'ops', text: 'deploy' });
        return { status: 'completed' };
      },
    });
    await harness.open({ principal: master, entry: 'zhin', body: humanBody('deploy'), budget: BUDGET });
    await harness.idle();
    expect(outcome).toMatchObject({ ok: false, code: 'contact_not_allowed', escalated: false });
    expect(seen.map((turn) => turn.actor)).toEqual(['zhin']);
  });

  it('denies an ask back to an actor that is waiting, and escalates instead of deadlocking', async () => {
    let bobOutcome: unknown;
    const { harness, escalations } = setup([ceiling('alice', ALL), ceiling('bob', ALL)], {
      alice: async (mail, h) => {
        const outcome = await h.send('alice', mail, { kind: 'ask', to: 'bob', text: 'Who owns this?' });
        return { status: 'completed', content: outcome.ok ? outcome.reply?.content : 'denied' };
      },
      bob: async (mail, h) => {
        bobOutcome = await h.send('bob', mail, { kind: 'ask', to: 'alice', text: 'Who owns this?' });
        return { status: 'completed', content: 'not me' };
      },
    });
    await harness.open({ principal: master, entry: 'alice', body: humanBody('who?'), budget: BUDGET });
    await harness.idle();
    expect(bobOutcome).toMatchObject({ ok: false, code: 'wait_cycle', escalated: true });
    expect(escalations.map((notice) => notice.code)).toEqual(['wait_cycle']);
  });

  it('rejects a grant larger than the delegator has left', async () => {
    let outcome: unknown;
    const { harness, seen } = setup([ceiling('zhin', ALL), ceiling('researcher', ALL)], {
      zhin: async (mail, h) => {
        outcome = await h.send('zhin', mail, { kind: 'ask', to: 'researcher', text: 'everything', budget: { modelCalls: 999 } });
        return { status: 'completed' };
      },
    });
    await harness.open({ principal: master, entry: 'zhin', body: humanBody('go'), budget: BUDGET });
    await harness.idle();
    expect(outcome).toMatchObject({ ok: false, code: 'budget_exceeded' });
    expect(seen.map((turn) => turn.actor)).toEqual(['zhin']);
  });

  it('reports overspend through charge and journals budget_exceeded', async () => {
    let charged: unknown;
    const { harness, journal } = setup([ceiling('zhin', ALL), ceiling('researcher', ALL)], {
      zhin: async (mail, h) => {
        await h.send('zhin', mail, { kind: 'ask', to: 'researcher', text: 'go', budget: { modelCalls: 1 } });
        return { status: 'completed' };
      },
      researcher: async (mail, h) => {
        await h.charge(mail, { modelCalls: 1 });
        charged = await h.charge(mail, { modelCalls: 1 });
        return { status: 'budget_exceeded', content: 'ran out' };
      },
    });
    const opened = await harness.open({ principal: master, entry: 'zhin', body: humanBody('go'), budget: BUDGET });
    if (!opened.ok) throw new Error('open failed');
    await harness.idle();
    expect(charged).toMatchObject({ ok: false, code: 'budget_exceeded', exhausted: ['modelCalls'] });
    expect(await eventTypes(journal, opened.engagement.id)).toContain('budget_exceeded');
  });

  it('only the actor processing a mail may send on its behalf', async () => {
    let outcome: unknown;
    const { harness } = setup([ceiling('zhin', ALL), ceiling('researcher', ALL)], {
      zhin: async (mail, h) => {
        outcome = await h.send('researcher', mail, { kind: 'tell', to: 'zhin', text: 'spoof' });
        return { status: 'completed' };
      },
    });
    await harness.open({ principal: master, entry: 'zhin', body: humanBody('go'), budget: BUDGET });
    await harness.idle();
    expect(outcome).toMatchObject({ ok: false, code: 'authority_not_attenuated' });
  });
});

describe('harness: attached root turn', () => {
  it('lets the live root turn ask, holds delegate results until detach, then closes', async () => {
    const { harness, journal, seen } = setup([ceiling('zhin', ALL), ceiling('researcher', ALL)], {
      researcher: async (mail) => ({ status: 'completed', content: mail.body.kind === 'ask' ? 'asked-answer' : 'delegated-answer' }),
    });
    const attached = await harness.attach({ principal: master, entry: 'zhin', body: humanBody('live'), budget: BUDGET });
    if (!attached.ok) throw new Error('attach failed');
    expect(seen).toEqual([]); // the root turn is not run by the mailbox
    const asked = await harness.send('zhin', attached.root, { kind: 'ask', to: 'researcher', text: 'q1' });
    expect(asked).toMatchObject({ ok: true, reply: { status: 'completed', content: 'asked-answer' } });
    const delegated = await harness.send('zhin', attached.root, { kind: 'delegate', to: 'researcher', text: 'q2' });
    expect(delegated.ok).toBe(true);
    await harness.idle();
    expect(seen.map((turn) => turn.actor)).toEqual(['researcher', 'researcher']); // nothing re-runs zhin
    expect(harness.engagement(attached.engagement.id)).toBeDefined();
    const held = await attached.detach({ status: 'completed' });
    expect(held.map((mail) => mail.body)).toEqual([expect.objectContaining({ kind: 'result', content: 'delegated-answer' })]);
    expect(await attached.detach({ status: 'completed' })).toBe(held);
    await harness.idle();
    // The held result continues as a normal turn of the root actor.
    expect(seen.map((turn) => `${turn.actor}:${turn.mails[0]!.kind}`)).toEqual(['researcher:ask', 'researcher:delegate', 'zhin:result']);
    expect(harness.engagement(attached.engagement.id)).toBeUndefined();
    expect((await eventTypes(journal, attached.engagement.id)).at(-1)).toBe('engagement_closed');
  });

  it('reports the remaining budget of a grant', async () => {
    const { harness } = setup([ceiling('zhin', ALL)], {});
    const attached = await harness.attach({ principal: master, entry: 'zhin', body: humanBody('live'), budget: BUDGET });
    if (!attached.ok) throw new Error('attach failed');
    await harness.charge(attached.root, { modelCalls: 3 });
    expect(harness.remaining(attached.root)?.modelCalls).toBe(17);
    await attached.detach({ status: 'completed' });
  });
});
