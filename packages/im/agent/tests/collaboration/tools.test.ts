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
import { MAX_AGENT_REPLY_CHARS, createCollaborationTools } from '../../src/collaboration/tools.js';

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
  const harness: Harness = createHarness({
    guard: createGuardKernel({ isAttenuationOf }),
    ledger: new InMemoryBudgetLedger(),
    journal: new InMemoryEngagementJournal(),
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
    expect(find(tools, 'delegate').description).toMatch(/without waiting/);
    expect(find(tools, 'delegate').description).toMatch(/never more/);
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
    await call(tools, 'ask', { agent: 'researcher', question: 'q', budget: { modelCalls: 3 } });
    expect(remaining).toBe(3);
  });

  it('refuses unknown agents without contacting the harness', async () => {
    const { tools } = await setup([ceiling('zhin')]);
    expect(await call(tools, 'ask', { agent: 'ghost', question: 'q' })).toMatch(/unknown_agent.*ghost/);
  });

  it('refuses agents outside the contacts', async () => {
    const { tools, escalations } = await setup([ceiling('zhin', ALL, only(['researcher'])), ceiling('researcher'), ceiling('writer')]);
    const out = await call(tools, 'ask', { agent: 'writer', question: 'q' });
    expect(out).toMatch(/^ask refused \(contact_not_allowed\)/);
    expect(out).not.toMatch(/principal has been asked/);
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
    expect(inner).toMatch(/principal has been asked to decide/);
    expect(escalations.map((e) => e.code)).toEqual(['wait_cycle']);
  });
});

describe('collaboration tools: delegate and tell', () => {
  it('delegate returns a handle without reply text', async () => {
    const { tools, attached, harness } = await setup([ceiling('zhin'), ceiling('researcher')], {
      researcher: async () => ({ status: 'completed', content: 'SECRET RESULT' }),
    });
    const out = await call(tools, 'delegate', { agent: 'researcher', brief: 'Find it.', deliverable: 'a link' });
    expect(out).toMatch(/^delegated to researcher \(mail id\d+\); its result will arrive as a new message$/);
    expect(out).not.toContain('SECRET');
    const held = await attached.detach({ status: 'completed' });
    expect(held.map((m) => m.body)).toEqual([expect.objectContaining({ kind: 'result', content: 'SECRET RESULT' })]);
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
    const out = await call(tools, 'delegate', { brief: 'Background task' });
    expect(out).toMatch(/^delegated to zhin#worker-1 \(mail id\d+\); its result will arrive as a new message$/);
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

describe('collaboration tools: cancel_delegation', () => {
  const blocking: Behaviour = (_mail, signal) => new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
  });

  it('cancels a delegation this actor sent', async () => {
    const { tools } = await setup([ceiling('zhin'), ceiling('researcher')], { researcher: blocking });
    const out = await call(tools, 'delegate', { agent: 'researcher', brief: 'long job' });
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
