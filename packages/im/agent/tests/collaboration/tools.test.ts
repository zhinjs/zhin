import {
  ALL,
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
} from '@zhin.js/harness';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import type { CollaborationAgent, CollaborationDirectory } from '../../src/collaboration/contracts.js';
import { MAX_AGENT_REPLY_CHARS, MIN_DELEGATION_BUDGET, applyDelegationBudgetFloor, createCollaborationTools } from '../../src/collaboration/tools.js';
import { recordActorAttachments, resolveAttachmentRefs } from '../../src/media/agent-attachments.js';
import { recordDelegatedMediaSkips } from '../../src/collaboration/delegated-media-notice.js';
import { createDelegatedReads, noteResultAdmitted, takeConsumedResult } from '../../src/collaboration/delegation-waiters.js';
import { agentLoop, createUserMessage, EMPTY_TOKEN_USAGE, z, type AgentMessage, type AssistantMessage, type LlmCompletionPort, type LlmTool } from '@zhin.js/ai';
import { mergeToolOutboundElements } from '../../src/media/media-tool-bridge.js';

type Behaviour = (mail: Mail, signal: AbortSignal, harness: Harness) => Promise<ActorTurnResult>;

const OWNER = 'test-plugin' as ToolCapability['owner'];
const master: Principal = { kind: 'human', id: 'owner', trust: 'master', venue: { kind: 'private', id: 'owner' } };
const BUDGET: BudgetAmounts = { modelCalls: 20, tokens: 100_000, wallMs: 60_000, sideEffects: 10 };
const humanBody = { kind: 'human' as const, text: 'hi', venue: { kind: 'private', id: 'owner' } };

function ceiling(agent: string, tools: NameScope = ALL, contacts: NameScope = ALL): AgentCeiling {
  return { agent, tools, contacts, maxTrust: 'master', egress: { network: false, hosts: ALL }, acceptsFrom: ALL };
}

function agent(c: AgentCeiling, description = `${c.agent} agent`): CollaborationAgent {
  return { name: c.agent, displayName: c.agent, description, instructions: '', ceiling: c };
}

function directoryOf(ceilings: AgentCeiling[]): CollaborationDirectory {
  const agents = ceilings.map((c) => agent(c));
  return { entry: agents[0]!, get: (name) => agents.find((a) => a.name === name), list: () => agents };
}

async function setup(ceilings: AgentCeiling[], behaviours: Record<string, Behaviour> = {}, onEscalate?: (reason: string) => Promise<string>) {
  const byAgent = new Map(ceilings.map((c) => [c.agent, c]));
  const directory = directoryOf(ceilings);
  const escalations: EscalationNotice[] = [];
  let ids = 0;
  // ADR 0048 H3: the entry's root turn is a Mail turn; it stays live until the test detaches it.
  let releaseRoot!: (result: ActorTurnResult) => void;
  const rootResult = new Promise<ActorTurnResult>((resolve) => { releaseRoot = resolve; });
  let rootStarted!: () => void;
  const started = new Promise<void>((resolve) => { rootStarted = resolve; });
  const later: Mail[] = [];
  // As the host Mailbox does: admitted results reach a `delegate` that waits for them (#1250).
  const baseJournal = new InMemoryEngagementJournal();
  const journal = new Proxy(baseJournal, {
    get(target, key) {
      if (key === 'append') {
        return async (record: Parameters<InMemoryEngagementJournal['append']>[0]) => {
          const appended = await target.append(record);
          const admitted = record.type === 'mail_admitted' && record.data.kind === 'result'
            ? harness.graph(record.engagementId)?.get(record.data.mailId as string) : undefined;
          if (admitted) noteResultAdmitted(harness, admitted);
          return appended;
        };
      }
      const value = Reflect.get(target, key) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const harness: Harness = createHarness({
    guard: createGuardKernel({ isAttenuationOf }),
    ledger: new InMemoryBudgetLedger(),
    journal,
    createMailbox: (options) => createMailbox(options),
    ceilingOf: (name) => byAgent.get(name),
    rootAuthority,
    attenuate,
    newId: () => `id${++ids}`,
    onEscalate: (notice) => { escalations.push(notice); },
    runTurn: async (actor, batch, signal) => {
      if (batch[0]!.body.kind === 'human') {
        rootStarted();
        return rootResult;
      }
      if (actor === ceilings[0]!.agent && batch.every((m) => m.body.kind === 'result')) {
        later.push(...batch);
        return { status: 'completed' };
      }
      const behaviour = behaviours[actor];
      return behaviour ? behaviour(batch[0]!, signal, harness) : { status: 'completed', content: `${actor} done` };
    },
  });
  const opened = await harness.open({ principal: master, entry: ceilings[0]!.agent, body: humanBody, budget: BUDGET });
  if (!opened.ok) throw new Error(`open failed: ${opened.code}`);
  await started;
  const attached = {
    root: opened.root,
    /** Ends the root turn; returns the results the entry got afterwards. */
    detach: async (result: ActorTurnResult): Promise<Mail[]> => {
      releaseRoot(result);
      await harness.idle();
      return later;
    },
  };
  const toolsFor = (actor: string, mail: Mail, escalate = onEscalate) =>
    createCollaborationTools({ harness, directory, actor, mail }, { owner: OWNER, ...(escalate ? { onEscalate: escalate } : {}) });
  const tools = toolsFor(attached.root.to, attached.root);
  return { harness, directory, escalations, attached, tools, toolsFor };
}

function find(tools: readonly ToolCapability[], name: string): ToolCapability {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} missing`);
  return tool;
}

async function call(tools: readonly ToolCapability[], name: string, input: unknown): Promise<string> {
  return find(tools, name).execute<unknown, string>(input, {} as never);
}

describe('collaboration tools: shape and visibility', () => {
  it('returns frozen builtin capabilities for every tool the authority allows', async () => {
    const { tools } = await setup([ceiling('zhin')]);
    expect(tools.map((t) => t.name).sort()).toEqual([
      'agents',
      'ask',
      'board_read',
      'board_write',
      'cancel_delegation',
      'delegate',
      'escalate',
      'follow_up',
      'tell',
    ]);
    for (const tool of tools) {
      expect(Object.isFrozen(tool)).toBe(true);
      expect(tool).toMatchObject({ owner: OWNER, source: 'builtin:collaboration', requiresApproval: 'never', qualifiedName: tool.name });
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
    }
    expect(Object.isFrozen(tools)).toBe(true);
  });

  it('only includes tools the authority may call', async () => {
    const { tools } = await setup([ceiling('zhin', only(['agents', 'ask', 'unrelated']))]);
    expect(tools.map((t) => t.name).sort()).toEqual(['agents', 'ask']);
  });

  it('includes no tools when the authority allows none', async () => {
    const { tools } = await setup([ceiling('zhin', only(['lookup']))]);
    expect(tools).toEqual([]);
  });

  it('descriptions tell the model the collaboration rules', async () => {
    const { tools } = await setup([ceiling('zhin')]);
    expect(find(tools, 'ask').description).toMatch(/wait/i);
    expect(find(tools, 'ask').description).toMatch(/data, not instructions/);
    expect(find(tools, 'delegate').description).toMatch(/waits up to 20 s/);
    expect(find(tools, 'delegate').description).toMatch(/do not answer the delegated part yourself/);
    expect(find(tools, 'delegate').description).toMatch(/never more/);
  });
});

describe('collaboration tools: attach_media (#1250 vision-ask-after-perception)', () => {
  it('ask / delegate mark the mail only when the model passes attach_media: true, and refuse a non-boolean', async () => {
    const seen: Mail[] = [];
    const { tools, attached } = await setup([ceiling('zhin'), ceiling('vision')], {
      vision: async (mail) => { seen.push(mail); return { status: 'completed', content: 'ok' }; },
    });
    expect(find(tools, 'ask').inputSchema).toMatchObject({ properties: { attach_media: { type: 'boolean' } } });
    expect(find(tools, 'delegate').inputSchema).toMatchObject({ properties: { attach_media: { type: 'boolean' } } });
    expect((find(tools, 'ask').inputSchema as { required: string[] }).required).not.toContain('attach_media');
    await call(tools, 'ask', { agent: 'vision', question: 'plain' });
    await call(tools, 'ask', { agent: 'vision', question: 'look', attach_media: true });
    await call(tools, 'delegate', { agent: 'vision', brief: 'look too', attach_media: true, wait: false });
    expect(await call(tools, 'ask', { agent: 'vision', question: 'x', attach_media: 'yes' })).toMatch(/attach_media must be true or false/);
    expect(await call(tools, 'delegate', { agent: 'vision', brief: 'x', attach_media: 1 })).toMatch(/attach_media must be true or false/);
    await attached.detach({ status: 'completed' });
    expect(seen.map(mail => (mail.body as { attachMedia?: true }).attachMedia)).toEqual([undefined, true, true]);
  });

  it('tells the asking model when the media did not go along, and why (ask and a waited delegate)', async () => {
    const { tools, attached } = await setup([ceiling('zhin'), ceiling('vision')], {
      vision: async (mail, _signal, harness) => {
        // What the actor turn runner records for a mail whose requested media was left out.
        if ((mail.body as { attachMedia?: true }).attachMedia) recordDelegatedMediaSkips(harness, [mail.id], ['model_input', 'limit']);
        return { status: 'completed', content: 'ok' };
      },
    });
    const asked = await call(tools, 'ask', { agent: 'vision', question: 'look', attach_media: true });
    expect(asked).toMatch(/\[Media not attached to vision: that agent's model does not take this kind of media; the media limit for this request \(count or size\) is used up\.\]$/u);
    // Outside the agent's own (external) reply.
    expect(asked.indexOf('[Media not attached')).toBeGreaterThan(asked.indexOf('[end external_content]'));
    const delegated = await call(tools, 'delegate', { agent: 'vision', brief: 'look', attach_media: true });
    expect(delegated).toContain('[Media not attached to vision:');
    // Taken once; a request without attach_media gets no note.
    expect(await call(tools, 'ask', { agent: 'vision', question: 'plain' })).not.toContain('Media not attached');
    await attached.detach({ status: 'completed' });
  });
});

describe('collaboration tools: agents', () => {
  it('lists only contactable agents, never the actor itself', async () => {
    const { tools } = await setup([ceiling('zhin', ALL, only(['researcher'])), ceiling('researcher'), ceiling('writer')]);
    expect(await call(tools, 'agents', {})).toBe('researcher — researcher agent');
  });

  it('says so when no agent can be contacted', async () => {
    const { tools } = await setup([ceiling('zhin', ALL, only([])), ceiling('researcher')]);
    expect(await call(tools, 'agents', undefined)).toMatch(/No agents/);
  });
});

describe('collaboration tools: ask', () => {
  it('returns the reply as wrapped external content with a status line', async () => {
    const { tools } = await setup([ceiling('zhin'), ceiling('researcher')], {
      researcher: async (mail) => ({ status: 'completed', content: mail.body.kind === 'ask' ? `answer to ${mail.body.question}` : '' }),
    });
    const out = await call(tools, 'ask', { agent: 'researcher', question: 'When is LTS?' });
    expect(out.split('\n')[0]).toBe('agent researcher replied (completed):');
    expect(out).toContain('[external_content source="agent_reply"');
    expect(out).toContain('answer to When is LTS?');
    expect(out).toContain('[end external_content]');
  });

  it('returns media the sub-agent produced as framework attachments the reply sends (#1250)', async () => {
    const { tools } = await setup([ceiling('zhin'), ceiling('draw')], {
      draw: async (mail, _signal, harness) => {
        // What the actor turn runner records for the mail it answered.
        recordActorAttachments(harness, [mail.id], [{ type: 'image', url: 'https://cdn.example/cat.png' }]);
        return { status: 'completed', content: 'Done, drew a cat.' };
      },
    });
    const out = await call(tools, 'ask', { agent: 'draw', question: 'draw a cat' });
    expect(out).toContain('Attachments from agent draw (1)');
    expect(out).not.toContain('https://cdn.example/cat.png');
    const media = resolveAttachmentRefs(out);
    expect(media).toEqual([{ type: 'image', url: 'https://cdn.example/cat.png' }]);
    // A reference resolves once; a copied or invented one resolves to nothing.
    expect(resolveAttachmentRefs(out)).toEqual([]);
    expect(resolveAttachmentRefs('zhin-attachment:00000000-0000-4000-8000-000000000000')).toEqual([]);
    // The asking turn merges them into its reply like any tool media.
    const merged = mergeToolOutboundElements([{ type: 'text', content: 'Here is your cat' }], [{ tool: 'ask', result: out, media }]);
    expect(merged).toContainEqual({ type: 'image', url: 'https://cdn.example/cat.png' });
  });

  it('clips long replies', async () => {
    const { tools } = await setup([ceiling('zhin'), ceiling('researcher')], {
      researcher: async () => ({ status: 'completed', content: 'x'.repeat(MAX_AGENT_REPLY_CHARS + 500) }),
    });
    const out = await call(tools, 'ask', { agent: 'researcher', question: 'dump' });
    expect(out).toContain('reply clipped');
    expect(out).not.toContain('x'.repeat(MAX_AGENT_REPLY_CHARS + 1));
  });

  it('passes a budget through to the harness', async () => {
    let remaining: number | undefined;
    const { tools } = await setup([ceiling('zhin'), ceiling('researcher')], {
      researcher: async (mail, _signal, harness) => {
        remaining = harness.remaining(mail)?.modelCalls;
        return { status: 'completed', content: 'ok' };
      },
    });
    await call(tools, 'ask', { agent: 'researcher', question: 'q', budget: { modelCalls: 5 } });
    expect(remaining).toBe(5);
  });

  it('raises a budget below one complete answer to the floor and says so (#1250 delegate-budget-self-sabotage)', async () => {
    const seen: Array<BudgetAmounts | undefined> = [];
    const { tools } = await setup([ceiling('zhin'), ceiling('researcher')], {
      researcher: async (mail, _signal, harness) => {
        seen.push(harness.remaining(mail));
        return { status: 'completed', content: 'ok' };
      },
    });
    const out = await call(tools, 'ask', { agent: 'researcher', question: 'q', budget: { modelCalls: 1, tokens: 250, sideEffects: 1 } });
    expect(seen[0]).toMatchObject({ modelCalls: MIN_DELEGATION_BUDGET.modelCalls, tokens: MIN_DELEGATION_BUDGET.tokens, sideEffects: 1 });
    expect(out).toContain(`budget raised to the minimum for one complete answer: modelCalls 1→${MIN_DELEGATION_BUDGET.modelCalls}, tokens 250→${MIN_DELEGATION_BUDGET.tokens}`);
  });

  it('never raises a budget floor above half of what the asker has left', () => {
    const remaining = { modelCalls: 6, tokens: 100_000, wallMs: 10_000, sideEffects: 5 };
    expect(applyDelegationBudgetFloor({ modelCalls: 1, tokens: 500, wallMs: 1_000 }, remaining)).toEqual({
      amounts: { modelCalls: 3, tokens: MIN_DELEGATION_BUDGET.tokens, wallMs: 5_000 },
      raised: ['modelCalls 1→3', `tokens 500→${MIN_DELEGATION_BUDGET.tokens}`, 'wallMs 1000→5000'],
    });
    expect(applyDelegationBudgetFloor({ modelCalls: 1 }, { ...remaining, modelCalls: 2 })).toEqual({ amounts: { modelCalls: 1 }, raised: [] });
    expect(applyDelegationBudgetFloor({ modelCalls: 10 }, remaining)).toEqual({ amounts: { modelCalls: 10 }, raised: [] });
  });

  it('accepts three parallel one-call delegations out of six remaining calls (the floor does not eat the budget)', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const { harness, toolsFor, attached } = await setup([ceiling('zhin'), ceiling('a'), ceiling('b'), ceiling('c')], {
      a: async () => { await hold; return { status: 'completed', content: 'a' }; },
      b: async () => { await hold; return { status: 'completed', content: 'b' }; },
      c: async () => { await hold; return { status: 'completed', content: 'c' }; },
      'zhin#worker-1': async () => { await hold; return { status: 'completed', content: 'coordinated' }; },
    });
    // A grant of six model calls for the delegating mail: its remaining budget is 6.
    const sent = await harness.send('zhin', attached.root, { kind: 'delegate', to: 'zhin#worker-1', text: 'coordinate', budget: { modelCalls: 6 } });
    if (!sent.ok) throw new Error(`grant failed: ${sent.code}`);
    expect(harness.remaining(sent.mail)?.modelCalls).toBe(6);
    const tools = toolsFor('zhin#worker-1', sent.mail);
    const outs = await Promise.all(['a', 'b', 'c'].map(agent => call(tools, 'delegate', { agent, brief: 'part', budget: { modelCalls: 1 }, wait: false })));
    for (const [index, out] of outs.entries()) expect(out).toMatch(new RegExp(`^delegated to ${['a', 'b', 'c'][index]} \\(mail id\\d+\\)`));
    expect(harness.remaining(sent.mail)!.modelCalls).toBeGreaterThanOrEqual(0);
    release();
    await attached.detach({ status: 'completed' });
  });

  it('refuses a fresh ask to an agent still working on a delegation (one line of work)', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const { tools, attached } = await setup([ceiling('zhin'), ceiling('planner')], {
      planner: async () => { await hold; return { status: 'completed', content: 'plan' }; },
    });
    const delegated = await call(tools, 'delegate', { agent: 'planner', brief: 'Plan the weekend.', wait: false });
    const mailId = /mail (id\d+)/.exec(delegated)![1]!;
    const refused = await call(tools, 'ask', { agent: 'planner', question: 'Done yet?' });
    expect(refused).toMatch(/^ask refused \(delegation_in_progress\)/);
    expect(refused).toContain(`mail ${mailId}`);
    expect(refused).toContain('follow_up');
    release();
    await attached.detach({ status: 'completed' });
  });

  it('asks again once the delegated result has arrived', async () => {
    const { tools, harness, attached } = await setup([ceiling('zhin'), ceiling('planner')]);
    const delegated = await call(tools, 'delegate', { agent: 'planner', brief: 'Plan the weekend.' });
    const mailId = /mail (id\d+)/.exec(delegated)![1]!;
    await vi.waitFor(() => expect(harness.graph(attached.root.engagementId)!.outstanding!(mailId)).toBe(false));
    expect(await call(tools, 'ask', { agent: 'planner', question: 'One more?' })).toMatch(/^agent planner replied \(completed\)/);
    await attached.detach({ status: 'completed' });
  });

  it('refuses unknown agents without contacting the harness', async () => {
    const { tools } = await setup([ceiling('zhin')]);
    expect(await call(tools, 'ask', { agent: 'ghost', question: 'q' })).toMatch(/unknown_agent.*ghost/);
  });

  it('refuses agents outside the contacts', async () => {
    const { tools, escalations } = await setup([ceiling('zhin', ALL, only(['researcher'])), ceiling('researcher'), ceiling('writer')]);
    const out = await call(tools, 'ask', { agent: 'writer', question: 'q' });
    expect(out).toMatch(/^ask refused \(contact_not_allowed\)/);
    expect(out).not.toMatch(/has stopped at its limit/);
    expect(escalations).toEqual([]);
  });

  it('reports an escalated wait cycle', async () => {
    let inner = '';
    const { tools, escalations } = await setup([ceiling('zhin'), ceiling('researcher')], {
      researcher: async (mail, _signal, harness) => {
        const own = createCollaborationTools({ harness, directory: directoryOf([ceiling('zhin'), ceiling('researcher')]), actor: 'researcher', mail }, { owner: OWNER });
        inner = await call(own, 'ask', { agent: 'zhin', question: 'what did you mean?' });
        return { status: 'completed', content: 'gave up' };
      },
    });
    await call(tools, 'ask', { agent: 'researcher', question: 'q' });
    expect(inner).toMatch(/^ask refused \(wait_cycle\)/);
    expect(inner).toMatch(/Collaboration for this request has stopped/);
    expect(inner).not.toMatch(/principal has been asked/);
    expect(escalations.map((e) => e.code)).toEqual(['wait_cycle']);
  });
});

describe('collaboration tools: delegate and tell', () => {
  it('delegate returns a handle without reply text', async () => {
    const { tools, attached, harness } = await setup([ceiling('zhin'), ceiling('researcher')], {
      researcher: async () => ({ status: 'completed', content: 'SECRET RESULT' }),
    });
    const out = await call(tools, 'delegate', { agent: 'researcher', brief: 'Find it.', deliverable: 'a link', wait: false });
    expect(out).toMatch(/^delegated to researcher \(mail id\d+\); its result will arrive as a new message\. Do not answer the delegated part yourself/);
    expect(out).not.toContain('SECRET');
    const held = await attached.detach({ status: 'completed' });
    expect(held.map((m) => m.body)).toEqual([expect.objectContaining({ kind: 'result', content: 'SECRET RESULT' })]);
  });

  it('delegate waits for a short result within the turn and returns it, so the model answers once (#1250 delegate-result-double-reply)', async () => {
    const { attached, harness, directory } = await setup([ceiling('zhin'), ceiling('vision')], {
      vision: async () => ({ status: 'completed', content: '一只橘猫趴在窗台上。' }),
    });
    const reads = createDelegatedReads(harness);
    const tools = createCollaborationTools({ harness, directory, actor: 'zhin', mail: attached.root }, { owner: OWNER, delegatedReads: reads });
    const out = await call(tools, 'delegate', { agent: 'vision', brief: '画的是什么，一句话回答' });
    expect(out).toMatch(/^agent vision finished \(completed, mail id\d+\):/);
    expect(out).toContain('一只橘猫趴在窗台上。');
    expect(out).toContain('[external_content source="agent_reply"');
    // The turn's answer reached the human: its read is consumed, so the later result mail does not wake
    // the entry agent again; the record is removed once taken.
    expect(reads.commit()).toHaveLength(1);
    const held = await attached.detach({ status: 'completed' });
    expect(held).toHaveLength(1);
    expect(await takeConsumedResult(harness, held[0]!)).toBe(true);
    expect(await takeConsumedResult(harness, held[0]!)).toBe(false);
  });

  it('a read whose turn failed is revoked: the result wakes the delegator as before (#1250)', async () => {
    const { attached, harness, directory } = await setup([ceiling('zhin'), ceiling('vision')], {
      vision: async () => ({ status: 'completed', content: '一只橘猫。' }),
    });
    const reads = createDelegatedReads(harness);
    const tools = createCollaborationTools({ harness, directory, actor: 'zhin', mail: attached.root }, { owner: OWNER, delegatedReads: reads });
    expect(await call(tools, 'delegate', { agent: 'vision', brief: '画的是什么' })).toContain('一只橘猫。');
    const held = await attached.detach({ status: 'completed' });
    // The lane waits for the reading turn to decide; the turn then fails (model error, timeout, stop).
    const taken = takeConsumedResult(harness, held[0]!);
    reads.revoke();
    expect(await taken).toBe(false);
  });

  it('a read noted after the final commit is not recorded: its result runs at once (#1250 第 56 批)', async () => {
    vi.useFakeTimers();
    try {
      const harness = {} as Harness;
      const result = (id: string) => ({ id, body: { kind: 'result', inReplyTo: `d-${id}`, status: 'completed', content: id } }) as unknown as Mail;
      // A root turn's answer phase commits, then a later phase of the same turn reads another result:
      // that read stays pending until the turn's next decision.
      const root = createDelegatedReads(harness);
      root.note(result('r1'));
      expect(root.commit()).toHaveLength(1);
      root.note(result('r2'));
      const pending = takeConsumedResult(harness, result('r2'));
      expect(root.commit({ final: true }).map((mail) => mail.id)).toEqual(['r2']);
      expect(await pending).toBe(true);
      // After the final commit (the turn ended) a late tool's read is not recorded: no 120 s wait.
      root.note(result('r3'));
      let settled = false;
      const late = takeConsumedResult(harness, result('r3')).then((consumed) => { settled = true; return consumed; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      expect(await late).toBe(false);
      // The same holds for an actor turn's reads.
      const actor = createDelegatedReads(harness);
      actor.commit({ final: true });
      actor.note(result('a1'));
      expect(await takeConsumedResult(harness, result('a1'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps no early result once no delegate is sending (#1250)', async () => {
    const { attached, harness } = await setup([ceiling('zhin'), ceiling('vision')]);
    const stray = { ...attached.root, id: 'stray-result', body: { kind: 'result', inReplyTo: 'nobody', status: 'completed', content: 'x' } } as unknown as Mail;
    noteResultAdmitted(harness, stray);
    const reads = createDelegatedReads(harness);
    const { awaitDelegatedResult } = await import('../../src/collaboration/delegation-waiters.js');
    expect(await awaitDelegatedResult(harness, 'nobody', 0, undefined, reads)).toBeUndefined();
    await attached.detach({ status: 'completed' });
  });

  it('delegate falls back to the result mail when the wait times out, and tells the model not to answer itself', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const { harness, directory, attached } = await setup([ceiling('zhin'), ceiling('vision')], {
      vision: async () => { await hold; return { status: 'completed', content: 'late answer' }; },
    });
    const tools = createCollaborationTools({ harness, directory, actor: 'zhin', mail: attached.root }, { owner: OWNER, delegateWaitMs: 20 });
    const out = await call(tools, 'delegate', { agent: 'vision', brief: 'Describe the image.' });
    expect(out).toMatch(/^vision is still working after 0 s \(mail id\d+\); its result will arrive as a new message\./);
    expect(out).toContain('Do not answer the delegated part yourself');
    expect(out).not.toContain('late answer');
    release();
    const held = await attached.detach({ status: 'completed' });
    expect(held.map((m) => m.body)).toEqual([expect.objectContaining({ kind: 'result', content: 'late answer' })]);
    // Nobody read it in the turn: it wakes the entry agent as before.
    expect(await takeConsumedResult(harness, held[0]!)).toBe(false);
  });

  it('delegate stops waiting when the turn is stopped', async () => {
    const { tools, attached } = await setup([ceiling('zhin'), ceiling('vision')], {
      vision: (_mail, signal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
      }),
    });
    const stop = new AbortController();
    const started = Date.now();
    const pending = find(tools, 'delegate').execute<unknown, string>({ agent: 'vision', brief: 'Describe.' }, { signal: stop.signal } as never);
    setTimeout(() => stop.abort(), 20);
    expect(await pending).toContain('its result will arrive as a new message');
    expect(Date.now() - started).toBeLessThan(5_000);
    void attached;
  });

  it('delegate refuses a non-boolean wait', async () => {
    const { tools } = await setup([ceiling('zhin'), ceiling('vision')]);
    expect(await call(tools, 'delegate', { agent: 'vision', brief: 'x', wait: 'yes' })).toBe('delegate refused: wait must be true or false.');
  });

  it('tell sends a one-way note', async () => {
    const seen: Mail[] = [];
    const { tools, attached } = await setup([ceiling('zhin'), ceiling('writer')], {
      writer: async (mail) => { seen.push(mail); return { status: 'completed' }; },
    });
    expect(await call(tools, 'tell', { agent: 'writer', content: 'FYI' })).toMatch(/^told writer \(mail id\d+\)$/);
    await attached.detach({ status: 'completed' });
    expect(seen.map((m) => m.body)).toEqual([{ kind: 'tell', content: 'FYI' }]);
  });

  it('delegate with omitted agent or "self" delegates to an isolated ephemeral worker of the current agent', async () => {
    const seenActors: string[] = [];
    const { tools, attached } = await setup([ceiling('zhin')], {
      'zhin#worker-1': async () => { seenActors.push('zhin#worker-1'); return { status: 'completed', content: 'worker done' }; },
    });
    const out = await call(tools, 'delegate', { brief: 'Background task', wait: false });
    expect(out).toMatch(/^delegated to zhin#worker-1 \(mail id\d+\); its result will arrive as a new message\./);
    const held = await attached.detach({ status: 'completed' });
    expect(seenActors).toEqual(['zhin#worker-1']);
    expect(held.map((m) => m.body)).toEqual([expect.objectContaining({ kind: 'result', content: 'worker done' })]);
  });

  it('follow_up sends a follow-up on previously delegated work and returns the wrapped reply', async () => {
    let calls = 0;
    const { tools, attached } = await setup([ceiling('zhin'), ceiling('researcher')], {
      researcher: async (mail) => {
        calls += 1;
        return {
          status: 'completed',
          content: mail.body.kind === 'ask' ? `follow-up reply #${calls}` : `initial reply #${calls}`,
        };
      },
    });
    const delOut = await call(tools, 'delegate', { agent: 'researcher', brief: 'Draft outline' });
    const mailId = /mail (id\d+)/.exec(delOut)![1]!;
    const followOut = await call(tools, 'follow_up', { mail_id: mailId, content: 'Add section 3' });
    expect(followOut).toContain('agent researcher replied (completed');
    expect(followOut).toContain('follow-up reply #');
    await attached.detach({ status: 'completed' });
  });

  it('board_write and board_read share blackboard state across actors in the engagement', async () => {
    const { tools, toolsFor, attached } = await setup([ceiling('zhin'), ceiling('researcher')], {
      researcher: async (mail, _signal, harness) => {
        const peerTools = toolsFor('researcher', mail);
        await call(peerTools, 'board_write', { key: 'findings', kind: 'artifact', content: 'peer secret findings' });
        return { status: 'completed', content: 'wrote findings' };
      },
    });
    expect(await call(tools, 'board_write', { key: 'plan', kind: 'todo', content: 'Step 1', status: 'in_progress' }))
      .toBe('wrote board entry "plan" (todo, v1)');
    await call(tools, 'ask', { agent: 'researcher', question: 'gather findings' });
    const allBoard = await call(tools, 'board_read', {});
    expect(allBoard).toContain('[board key="plan" kind="todo" v1 by zhin status=in_progress]');
    expect(allBoard).toContain('[board key="findings" kind="artifact" v1 by researcher]');
    expect(allBoard).toContain('[external_content source="board:researcher"');
    expect(allBoard).toContain('peer secret findings');
    await attached.detach({ status: 'completed' });
  });
});

describe('collaboration tools: delegates of one model step (#1250)', () => {
  afterEach(() => { vi.useRealTimers(); });

  function assistant(content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']): AssistantMessage {
    return { role: 'assistant', content, api: 'test', provider: 'test', model: 'mock', usage: EMPTY_TOKEN_USAGE, stopReason, timestamp: Date.now() };
  }

  it('sends three delegates together and waits for them together: about 15 s, not 45 s, inside the turn timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const slow = (answer: string): Behaviour => async () => {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      return { status: 'completed', content: answer };
    };
    const { harness, directory, attached } = await setup([ceiling('zhin'), ceiling('a'), ceiling('b'), ceiling('c')], {
      a: slow('answer a'), b: slow('answer b'), c: slow('answer c'),
    });
    const TURN_TIMEOUT_MS = 60_000;
    const started = Date.now();
    const turnTimeout = new AbortController();
    const timer = setTimeout(() => turnTimeout.abort(new Error('turn timed out')), TURN_TIMEOUT_MS);
    const reads = createDelegatedReads(harness);
    const tools = createCollaborationTools({ harness, directory, actor: 'zhin', mail: attached.root },
      { owner: OWNER, delegatedReads: reads, turnDeadline: started + TURN_TIMEOUT_MS });
    const delegate = find(tools, 'delegate');
    const llmTools: LlmTool[] = [{ name: 'delegate', description: delegate.description, parameters: z.record(z.string(), z.unknown()) }];
    let calls = 0;
    const transport: LlmCompletionPort = {
      complete: async () => {
        calls += 1;
        return calls === 1
          ? assistant(['a', 'b', 'c'].map((agent) => ({ type: 'toolCall' as const, id: `call_${agent}`, name: 'delegate', arguments: { agent, brief: `part ${agent}` } })), 'toolUse')
          : assistant([{ type: 'text', text: 'done' }], 'stop');
      },
      completeSimple: async () => assistant([{ type: 'text', text: 'done' }], 'stop'),
    };
    const results: string[] = [];
    const loop = (async () => {
      for await (const event of agentLoop(createUserMessage('three parts'), { systemPrompt: '', messages: [], tools: llmTools }, {
        model: { id: 'mock', name: 'mock', api: 'test', provider: 'test' } as never,
        transport,
        maxIterations: 3,
        toolExecution: 'tiered',
        executeTool: async (toolCall, _tools, signal): Promise<AgentMessage> => {
          const text = await delegate.execute<unknown, string>(toolCall.arguments, { signal } as never);
          return { role: 'toolResult', toolCallId: toolCall.id, toolName: toolCall.name, content: [{ type: 'text', text }], timestamp: Date.now() };
        },
      }, turnTimeout.signal)) {
        if (event.type === 'tool_execution_end') {
          const block = (event.result as { content?: Array<{ text?: string }> }).content?.[0];
          results.push(block?.text ?? '');
        }
      }
    })();
    for (let step = 0; step < 50 && results.length < 3; step += 1) await vi.advanceTimersByTimeAsync(500);
    await loop;
    const elapsed = Date.now() - started;
    clearTimeout(timer);
    expect(results).toHaveLength(3);
    for (const agent of ['a', 'b', 'c']) expect(results.some((text) => text.includes(`agent ${agent} finished (completed`) && text.includes(`answer ${agent}`))).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(15_000);
    expect(elapsed).toBeLessThan(20_000);
    expect(turnTimeout.signal.aborted).toBe(false);
    vi.useRealTimers();
    await attached.detach({ status: 'completed' });
  });

  it('shares one wait budget per turn: concurrent waits end together, and never run into the turn timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { createDelegateWaitBudget } = await import('../../src/collaboration/tools.js');
    const budget = createDelegateWaitBudget({ totalMs: 20_000 });
    expect(budget.available()).toBe(20_000);
    const endFirst = budget.begin();
    vi.advanceTimersByTime(5_000);
    // A wait starting 5 s later gets the rest, so it ends with the first one.
    expect(budget.available()).toBe(15_000);
    const endSecond = budget.begin();
    vi.advanceTimersByTime(15_000);
    endFirst();
    endSecond();
    expect(budget.available()).toBe(0);
    // The turn's elapsed time counts too: 40 s into a 60 s turn only 5 s are left for waiting.
    const late = createDelegateWaitBudget({ totalMs: 20_000, deadline: Date.now() + 20_000 });
    expect(late.available()).toBe(5_000);
    expect(createDelegateWaitBudget({ totalMs: 20_000, deadline: Date.now() + 10_000 }).available()).toBe(0);
  });
});

describe('collaboration tools: cancel_delegation', () => {
  const blocking: Behaviour = (_mail, signal) => new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
  });

  it('cancels a delegation this actor sent', async () => {
    const { tools } = await setup([ceiling('zhin'), ceiling('researcher')], { researcher: blocking });
    const out = await call(tools, 'delegate', { agent: 'researcher', brief: 'long job', wait: false });
    const mailId = /mail (id\d+)/.exec(out)![1]!;
    expect(await call(tools, 'cancel_delegation', { mail_id: mailId })).toBe(`cancelled ${mailId} (to researcher)`);
  });

  it('refuses mails this actor did not send', async () => {
    let foreign = '';
    const { tools, attached, harness } = await setup([ceiling('zhin'), ceiling('researcher'), ceiling('writer')], {
      researcher: async (mail, _signal, h) => {
        const sent = await h.send('researcher', mail, { kind: 'delegate', to: 'writer', text: 'sub job' });
        foreign = sent.ok ? sent.mail.id : '';
        return { status: 'completed', content: 'ok' };
      },
      writer: blocking,
    });
    await call(tools, 'ask', { agent: 'researcher', question: 'go' });
    expect(foreign).not.toBe('');
    expect(await call(tools, 'cancel_delegation', { mail_id: foreign })).toMatch(/not work you delegated/);
    expect(await call(tools, 'cancel_delegation', { mail_id: attached.root.id })).toMatch(/not work you delegated/);
    expect(await call(tools, 'cancel_delegation', { mail_id: 'nope' })).toMatch(/not work you delegated/);
    harness.cancel(foreign);
  });
});

describe('collaboration tools: escalate', () => {
  it('asks the principal through onEscalate and wraps the answer', async () => {
    const asked: string[] = [];
    const { tools } = await setup([ceiling('zhin')], {}, async (reason) => { asked.push(reason); return 'go ahead'; });
    const out = await call(tools, 'escalate', { reason: 'delete the branch?' });
    expect(asked).toEqual(['delete the branch?']);
    expect(out).toContain('[external_content source="principal_answer"');
    expect(out).toContain('go ahead');
  });

  it('reports that escalation is unavailable without onEscalate', async () => {
    const { tools } = await setup([ceiling('zhin')]);
    expect(await call(tools, 'escalate', { reason: 'help' })).toMatch(/^escalate unavailable/);
  });
});

describe('collaboration tools: bad input', () => {
  it.each([
    ['ask', undefined, /provide agent/],
    ['ask', 'not an object', /provide agent/],
    ['ask', { agent: '  ', question: 'q' }, /provide agent/],
    ['ask', { agent: 42, question: 'q' }, /provide agent/],
    ['ask', { agent: 'researcher' }, /non-empty question/],
    ['ask', { agent: 'researcher', question: 'q', budget: { modelCalls: 0 } }, /positive integer/],
    ['ask', { agent: 'researcher', question: 'q', budget: 'lots' }, /positive integer/],
    ['delegate', { agent: 'researcher', brief: '' }, /non-empty brief/],
    ['delegate', { agent: 'ghost', brief: 'x' }, /unknown_agent/],
    ['tell', { agent: 'researcher', content: null }, /non-empty content/],
    ['cancel_delegation', {}, /provide mail_id/],
    ['escalate', { reason: 1 }, /non-empty reason/],
  ])('%s(%j) is refused without throwing', async (name, input, expected) => {
    const { tools } = await setup([ceiling('zhin'), ceiling('researcher')], {}, async () => 'ok');
    await expect(call(tools, name, input)).resolves.toMatch(expected);
  });
});
