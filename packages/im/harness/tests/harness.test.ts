import {
  ALL,
  DEFAULT_GUARD_LIMITS,
  InMemoryBudgetLedger,
  InMemoryEngagementJournal,
  attenuate,
  createGuardKernel,
  createHarness,
  createInboxPolicy,
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

describe('harness: inbound delivery (H3)', () => {
  it('runs the root turn of a lane inside the mailbox and returns delegate results on that lane after it', async () => {
    const order: string[] = [];
    let release!: () => void;
    const rootDone = new Promise<void>((resolve) => { release = resolve; });
    const { harness, journal, seen } = setup([ceiling('zhin', ALL), ceiling('researcher', ALL)], {
      zhin: async (mail, h) => {
        if (mail.body.kind === 'result') {
          order.push(`zhin:result:${mail.lane}`);
          return { status: 'completed' };
        }
        const asked = await h.send('zhin', mail, { kind: 'ask', to: 'researcher', text: 'q1' });
        expect(asked).toMatchObject({ ok: true, reply: { status: 'completed', content: 'asked-answer' } });
        const delegated = await h.send('zhin', mail, { kind: 'delegate', to: 'researcher', text: 'q2' });
        expect(delegated.ok).toBe(true);
        await rootDone;
        order.push('zhin:root-done');
        return { status: 'completed' };
      },
      researcher: async (mail) => ({ status: 'completed', content: mail.body.kind === 'ask' ? 'asked-answer' : 'delegated-answer' }),
    });
    const opened = await harness.deliver({ principal: master, entry: 'zhin', body: humanBody('live'), budget: BUDGET, lane: 'im:s1' });
    if (!opened.ok) throw new Error('deliver failed');
    expect(opened).toMatchObject({ disposition: 'queued', position: 1 });
    expect(opened.root.lane).toBe('im:s1');
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
    release();
    await harness.idle();
    // The delegate result waited for the running root turn of the lane.
    expect(order).toEqual(['zhin:root-done', 'zhin:result:im:s1']);
    expect(seen.map((turn) => `${turn.actor}:${turn.mails[0]!.kind}`)).toEqual(['zhin:human', 'researcher:ask', 'researcher:delegate', 'zhin:result']);
    expect(harness.engagement(opened.engagement.id)).toBeUndefined();
    expect((await eventTypes(journal, opened.engagement.id)).at(-1)).toBe('engagement_closed');
  });

  it('hands the root mail to onPosting before the turn can start, and cancelSender drops queued mail', async () => {
    let release!: () => void;
    const block = new Promise<void>((resolve) => { release = resolve; });
    const posted: string[] = [];
    const ran: string[] = [];
    const { harness } = setup([ceiling('zhin', ALL)], {
      zhin: async (mail) => {
        ran.push(mail.id);
        expect(posted).toContain(mail.id);
        await block;
        return { status: 'completed' };
      },
    });
    const first = await harness.deliver({ principal: master, entry: 'zhin', body: humanBody('a'), budget: BUDGET, lane: 'im:s', onPosting: (root) => posted.push(root.id) });
    const queued = await harness.deliver({ principal: master, entry: 'zhin', body: humanBody('b'), budget: BUDGET, lane: 'im:s', onPosting: (root) => posted.push(root.id) });
    if (!first.ok || !queued.ok) throw new Error('deliver failed');
    expect(posted).toEqual([first.root.id, queued.root.id]);
    expect(harness.cancelSender('zhin', 'im:s', master.id, 'stopped')).toBe(1);
    release();
    await harness.idle();
    expect(ran).toEqual([first.root.id]);
  });

  it('reports the remaining budget of a grant', async () => {
    let remaining: number | undefined;
    const { harness } = setup([ceiling('zhin', ALL)], {
      zhin: async (mail, h) => {
        await h.charge(mail, { modelCalls: 3 });
        remaining = h.remaining(mail)?.modelCalls;
        return { status: 'completed' };
      },
    });
    await harness.open({ principal: master, entry: 'zhin', body: humanBody('live'), budget: BUDGET });
    await harness.idle();
    expect(remaining).toBe(17);
  });

  it('applies the inbox policy to mails delivered mid-turn and accounts merged engagements', async () => {
    const policy = createInboxPolicy({ maxQueuedTurns: 5, supersedeSameSender: true });
    const journal = new InMemoryEngagementJournal();
    const runs: Array<{ texts: string[]; signal: AbortSignal; finish: () => void }> = [];
    let ids = 0;
    const closedIds: string[] = [];
    const harness = createHarness({
      guard: createGuardKernel({ isAttenuationOf }),
      ledger: new InMemoryBudgetLedger(),
      journal,
      createMailbox: (options) => createMailbox(options),
      ceilingOf: (agent) => (agent === 'zhin' ? ceiling('zhin', ALL) : undefined),
      rootAuthority,
      attenuate,
      newId: () => `id${++ids}`,
      clock: () => 1000,
      inbox: { policy },
      onEngagementClosed: (engagement) => { closedIds.push(engagement.id); },
      runTurn: (_actor, batch, signal) => new Promise<ActorTurnResult>((resolve) => {
        runs.push({
          texts: batch.map((mail) => (mail.body.kind === 'human' ? mail.body.text : '')),
          signal,
          finish: () => resolve({ status: signal.aborted ? 'cancelled' : 'completed' }),
        });
        signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
      }),
    });
    const human = (text: string, extra: Record<string, unknown> = {}) => ({
      kind: 'human' as const, text, venue: { kind: 'private', id: 'owner' }, senderId: 'owner', plainText: true, ...extra,
    });
    const first = await harness.deliver({ principal: master, entry: 'zhin', body: human('book the morning'), budget: BUDGET, lane: 'im:s1' });
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(runs).toHaveLength(1);
    const second = await harness.deliver({ principal: master, entry: 'zhin', body: human('no, afternoon'), budget: BUDGET, lane: 'im:s1' });
    expect(second).toMatchObject({ ok: true, disposition: 'superseded' });
    expect(runs[0]!.signal.aborted).toBe(true);
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
    expect(runs).toHaveLength(2);
    expect(runs[1]!.texts).toEqual(['book the morning', 'no, afternoon']);
    runs[1]!.finish();
    await harness.idle();
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    if (!first.ok || !second.ok) throw new Error('deliver failed');
    // Both engagements closed although one batch answered them.
    expect(closedIds.sort()).toEqual([first.engagement.id, second.engagement.id].sort());

    const stop = await harness.deliver({ principal: master, entry: 'zhin', body: human('stop', { isStop: true }), budget: BUDGET, lane: 'im:s1' });
    expect(stop).toMatchObject({ ok: false, code: 'not_running' });
    const ignored = await harness.deliver({ principal: member, entry: 'zhin', body: human('chatter', { unaddressed: true, senderId: 'mallory' }), budget: BUDGET, lane: 'im:g1' });
    expect(ignored).toMatchObject({ ok: false, code: 'not_addressed' });
    expect(runs).toHaveLength(2);
  });
});

describe('harness: escalation freezes the engagement', () => {
  it('notifies once, cancels branches in flight and refuses later sends', async () => {
    const outcomes: unknown[] = [];
    const behaviours: Record<string, Behaviour> = {};
    const { harness, escalations } = setup([ceiling('zhin', ALL), ceiling('alice', ALL), ceiling('bob', ALL)], Object.assign(behaviours, {
      alice: async (mail, h) => {
        const outcome = await h.send('alice', mail, { kind: 'ask', to: 'bob', text: 'yours?' });
        return { status: 'completed', content: outcome.ok ? outcome.reply?.content : outcome.code };
      },
      bob: async (mail, h) => {
        outcomes.push(await h.send('bob', mail, { kind: 'ask', to: 'alice', text: 'yours?' }));
        outcomes.push(await h.send('bob', mail, { kind: 'tell', to: 'zhin', text: 'still here' }));
        return { status: 'completed', content: 'no' };
      },
    } satisfies Record<string, Behaviour>));
    let asked: unknown;
    let again: unknown;
    behaviours.zhin = async (mail, h) => {
      asked = await h.send('zhin', mail, { kind: 'ask', to: 'alice', text: 'who owns this?' });
      again = await h.send('zhin', mail, { kind: 'ask', to: 'bob', text: 'again' });
      return { status: 'completed' };
    };
    await harness.open({ principal: master, entry: 'zhin', body: humanBody('who?'), budget: BUDGET });
    await harness.idle();
    expect(asked).toMatchObject({ ok: true, reply: { status: 'cancelled' } });
    expect(outcomes).toEqual([
      expect.objectContaining({ ok: false, code: 'wait_cycle', escalated: true }),
      expect.objectContaining({ ok: false, code: 'frozen' }),
    ]);
    expect(escalations).toHaveLength(1);
    expect(again).toMatchObject({ ok: false, code: 'frozen' });
  });
});

describe('harness: blackboard, followUp, and remoteTransport (H5)', () => {
  it('writes, versions, filters, and reconstructs shared blackboard entries per engagement', async () => {
    const { harness, journal } = setup([ceiling('zhin', ALL), ceiling('researcher', ALL)], {});
    const v1 = await harness.writeBoard('eng-b1', {
      key: 'summary',
      content: 'initial notes',
      author: 'zhin',
    });
    expect(v1).toEqual({
      key: 'summary',
      kind: 'note',
      content: 'initial notes',
      author: 'zhin',
      updatedAt: 1000,
      version: 1,
    });
    const v2 = await harness.writeBoard('eng-b1', {
      key: 'summary',
      kind: 'artifact',
      content: 'refined spec',
      author: 'researcher',
    });
    expect(v2.version).toBe(2);
    expect(v2.kind).toBe('artifact');

    await harness.writeBoard('eng-b1', {
      key: 'task-1',
      kind: 'todo',
      content: 'verify tests',
      author: 'zhin',
      status: 'in_progress',
    });

    expect(await harness.readBoard('eng-b1')).toHaveLength(2);
    expect(await harness.readBoard('eng-b1', { kind: 'todo' })).toEqual([
      expect.objectContaining({ key: 'task-1', kind: 'todo', status: 'in_progress', version: 1 }),
    ]);
    expect(await harness.readBoard('eng-b1', { key: 'summary' })).toEqual([
      expect.objectContaining({ key: 'summary', kind: 'artifact', content: 'refined spec', version: 2 }),
    ]);
    await expect(harness.writeBoard('eng-b1', { key: '   ', content: 'x', author: 'zhin' })).rejects.toThrow(TypeError);

    // A fresh harness sharing the persisted journal reconstructs the board when its in-memory map is empty
    const freshHarness = createHarness({
      guard: createGuardKernel({ isAttenuationOf }),
      ledger: new InMemoryBudgetLedger(),
      journal,
      createMailbox: (options) => createMailbox(options),
      ceilingOf: () => ceiling('zhin', ALL),
      rootAuthority,
      attenuate,
      runTurn: async () => ({ status: 'completed' }),
    });
    const reconstructed = await freshHarness.readBoard('eng-b1');
    expect(reconstructed).toEqual([
      expect.objectContaining({ key: 'summary', kind: 'artifact', content: 'refined spec', version: 2 }),
      expect.objectContaining({ key: 'task-1', kind: 'todo', content: 'verify tests', status: 'in_progress', version: 1 }),
    ]);
  });

  it('follows up on delegated work with attenuated authority and rejects invalid handles', async () => {
    const receivedByResearcher: Mail[] = [];
    let delegatedMailId = '';
    const { harness } = setup([ceiling('zhin', ALL), ceiling('researcher', only(['lookup']))], {
      zhin: async (mail, h) => {
        if (mail.body.kind === 'result') return { status: 'completed', content: 'done' };
        const delegated = await h.send('zhin', mail, {
          kind: 'delegate',
          to: 'researcher',
          text: 'initial brief',
          narrowing: { tools: only(['lookup']) },
        });
        if (delegated.ok) delegatedMailId = delegated.mail.id;
        return { status: 'completed', content: 'started' };
      },
      researcher: async (mail) => {
        receivedByResearcher.push(mail);
        if (mail.body.kind === 'ask') {
          return { status: 'completed', content: `follow-up answer: ${mail.body.question}` };
        }
        return { status: 'completed', content: 'initial result' };
      },
    });

    await harness.open({ principal: member, entry: 'zhin', body: humanBody('start'), budget: BUDGET });
    await harness.idle();
    expect(delegatedMailId).not.toBe('');

    // Reject unknown mailId or wrong sender
    const unknownAck = await harness.followUp({ mailId: 'missing-id', from: 'zhin', content: 'status?' });
    expect(unknownAck).toMatchObject({
      accepted: false,
      mailId: 'missing-id',
      reason: { code: 'missing_causation' },
    });

    const wrongSenderAck = await harness.followUp({ mailId: delegatedMailId, from: 'researcher', content: 'spoof?' });
    expect(wrongSenderAck).toMatchObject({
      accepted: false,
      mailId: delegatedMailId,
      reason: { code: 'missing_causation' },
    });

    // Valid follow-up after initial delegation completed
    const ack = await harness.followUp({
      mailId: delegatedMailId,
      from: 'zhin',
      content: 'Also check edge cases',
    });
    expect(ack.accepted).toBe(true);
    expect(ack.result).toEqual({
      status: 'completed',
      content: `follow-up answer: [Follow-up on ${delegatedMailId}]\nAlso check edge cases`,
    });
    const followUpMail = receivedByResearcher.at(-1)!;
    expect(followUpMail.causationId).toBe(delegatedMailId);
    expect(followUpMail.authority.tools).toEqual(only(['lookup']));
    expect(followUpMail.authority.trust).toBe('group_member');
  });

  it('routes remote mails via remoteTransport with budget charging and timeout support', async () => {
    const journal = new InMemoryEngagementJournal();
    const remoteSent: Array<{ mail: Mail; budget: BudgetAmounts }> = [];
    let ids = 0;
    const harness = createHarness({
      guard: createGuardKernel({ isAttenuationOf }),
      ledger: new InMemoryBudgetLedger(),
      journal,
      createMailbox: (options) => createMailbox(options),
      ceilingOf: (agent) => {
        if (agent === 'zhin') return ceiling('zhin', ALL);
        if (agent === 'remote-worker') {
          return {
            ...ceiling('remote-worker', ALL),
            defaultBudget: { modelCalls: 4, tokens: 2000 },
          };
        }
        return undefined;
      },
      rootAuthority,
      attenuate,
      newId: () => `rm${++ids}`,
      clock: () => 2000,
      remoteTransport: {
        canRoute: (target) => target.startsWith('remote-'),
        send: async (mail, grantedBudget) => {
          remoteSent.push({ mail, budget: grantedBudget });
          if (mail.body.kind === 'ask' && mail.body.question === 'slow') {
            await new Promise((resolve) => setTimeout(resolve, 80));
            return { status: 'completed', content: 'too late' };
          }
          return {
            status: 'completed',
            content: `remote:${mail.kind}`,
            consumed: { modelCalls: 2, tokens: 300 },
          };
        },
      },
      runTurn: async (_actor, batch) => {
        const root = batch[0]!;
        const askRes = await harness.send('zhin', root, {
          kind: 'ask',
          to: 'remote-worker',
          text: 'ping remote',
        });
        expect(askRes).toMatchObject({
          accepted: true,
          result: { status: 'completed', content: 'remote:ask' },
        });
        const tellRes = await harness.send('zhin', root, {
          kind: 'tell',
          to: 'remote-worker',
          text: 'fyi remote',
        });
        expect(tellRes).toMatchObject({ accepted: true });
        const timeoutRes = await harness.send('zhin', root, {
          kind: 'ask',
          to: 'remote-worker',
          text: 'slow',
          timeoutMs: 10,
        });
        expect(timeoutRes).toMatchObject({
          accepted: true,
          result: { status: 'cancelled' },
        });
        return { status: 'completed', content: 'all done' };
      },
    });

    const opened = await harness.open({ principal: master, entry: 'zhin', body: humanBody('run remote'), budget: BUDGET });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await harness.idle();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Verify defaultBudget from AgentCeiling was used when request.budget was omitted
    expect(remoteSent[0]?.budget).toMatchObject({ modelCalls: 4, tokens: 2000 });
    const types = await eventTypes(journal, opened.engagement.id);
    expect(types).toContain('mail_delivered');
    expect(types).toContain('mail_completed');
    expect(types).toContain('mail_cancelled');
  });
});
