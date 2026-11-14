/**
 * #1250: IM approval prompts in the turn's own conversation. Only the bound person (master, owner or the
 * admin initiator) can answer; anybody else, another conversation, a stale button or a late answer cannot.
 */
import { RuntimeInteractionCoordinator } from '../../../../../core/src/plugin-runtime/im/interaction-runtime.js';
import { createRuntimeApprovalPort, resolveImApprover } from '@zhin.js/agent/runtime';

type Conversation = { endpoint: { adapter: string; id: string }; kind: 'private' | 'group'; id: string; threadId?: string };

function conversation(kind: Conversation['kind'] = 'private', id = 'alice'): Conversation {
  return { endpoint: { adapter: 'fixture', id: 'bot' }, kind, id };
}

function setup(subjectId: string, target = conversation()) {
  const coordinator = new RuntimeInteractionCoordinator();
  const prompts: unknown[] = [];
  const source = {
    locale: 'zh-CN' as const,
    conversation: target,
    generation: 1,
    sender: { id: subjectId },
    $reply: async (content: unknown) => {
      prompts.push(content);
      return { status: 'sent' as const };
    },
  };
  const interaction = coordinator.create(source, subjectId);
  const reply = (sender: string, content: string, extra: Record<string, unknown> = {}) =>
    coordinator.resolveClaim({ ...source, sender: { id: sender }, content, segments: [], ...extra } as never);
  return { coordinator, prompts, source, interaction, reply };
}

function buttonPayloads(prompt: unknown): string[] {
  return [...JSON.stringify(prompt).matchAll(/"payload":"(zhin:ask:[^"]+)"/g)].map(match => match[1]!);
}

const request = (overrides: Record<string, unknown> = {}) => ({
  requestId: 'turn:call',
  toolName: 'schedule_add',
  question: '创建定时任务\n本次参数：{"cron":"0 9 * * 1-5"}',
  signal: new AbortController().signal,
  timeoutMs: 5_000,
  ...overrides,
});

describe('resolveImApprover', () => {
  const base = { senderId: 'alice', isMaster: false, isAdmin: false, scope: 'private' as const, initiatorPresent: true };

  it('keeps the master and a present owner as approvers', () => {
    expect(resolveImApprover({ ...base, isMaster: true, ownerId: 'boss' })).toEqual({ kind: 'master', subjectId: 'alice' });
    expect(resolveImApprover({ ...base, scope: 'group', ownerId: 'boss' })).toEqual({ kind: 'owner', subjectId: 'boss' });
    expect(resolveImApprover({ ...base, scope: 'group', isAdmin: true, ownerId: 'boss' })).toEqual({ kind: 'owner', subjectId: 'boss' });
    expect(resolveImApprover({ ...base, ownerId: 'alice' })).toEqual({ kind: 'owner', subjectId: 'alice' });
  });

  it('lets a present admin initiator confirm when the owner cannot answer here', () => {
    expect(resolveImApprover({ ...base, isAdmin: true, ownerId: 'boss' })).toEqual({ kind: 'initiator', subjectId: 'alice' });
    expect(resolveImApprover({ ...base, isAdmin: true })).toEqual({ kind: 'initiator', subjectId: 'alice' });
    expect(resolveImApprover({ ...base, scope: 'group', isAdmin: true })).toEqual({ kind: 'initiator', subjectId: 'alice' });
  });

  it('never makes an ordinary member, an absent initiator or an unknown sender an approver', () => {
    expect(resolveImApprover({ ...base, ownerId: 'boss' })).toMatchObject({ kind: 'none', reason: expect.stringContaining('owner cannot answer') });
    expect(resolveImApprover(base)).toMatchObject({ kind: 'none', reason: expect.stringContaining('no bot owner') });
    expect(resolveImApprover({ ...base, isAdmin: true, initiatorPresent: false })).toMatchObject({ kind: 'none' });
    expect(resolveImApprover({ ...base, senderId: ' ', isAdmin: true })).toMatchObject({ kind: 'none' });
  });
});

describe('initiator self-approval port', () => {
  it('offers only allow-once / reject, accepts 确认 from the initiator and ignores everyone else', async () => {
    const f = setup('alice', conversation('group', 'room'));
    const memory = { recall: vi.fn(() => true), remember: vi.fn() };
    const port = createRuntimeApprovalPort({ isMaster: false, interaction: f.interaction, selfApproval: true, memory });
    const outcome = port.requestApprovalOutcome(request({ conversationScope: 'group' }));
    await vi.waitFor(() => expect(f.prompts).toHaveLength(1));
    const rendered = JSON.stringify(f.prompts[0]);
    expect(rendered).toContain('只有发起这次请求的人可以回答');
    expect(rendered).not.toContain('所有人');
    expect(rendered).not.toContain('始终允许');
    expect(buttonPayloads(f.prompts[0])).toHaveLength(2);

    expect(f.reply('mallory', '确认')).toBe(false);
    expect(f.reply('mallory', '1')).toBe(false);
    // A different platform user pressing the initiator's own button does not settle it either.
    expect(f.reply('mallory', '', { segments: [{ type: 'action', data: { payload: buttonPayloads(f.prompts[0])[1] } }] })).toBe(false);
    expect(f.reply('alice', '确认')).toBe(true);

    await expect(outcome).resolves.toEqual({ status: 'approved', decision: 'approve-once' });
    expect(memory.recall).not.toHaveBeenCalled();
    expect(memory.remember).not.toHaveBeenCalled();
  });

  it('treats 取消 / no as a rejection', async () => {
    for (const answer of ['取消', 'no']) {
      const f = setup('alice');
      const port = createRuntimeApprovalPort({ isMaster: false, interaction: f.interaction, selfApproval: true });
      const outcome = port.requestApprovalOutcome(request());
      await vi.waitFor(() => expect(f.prompts).toHaveLength(1));
      expect(f.reply('alice', answer)).toBe(true);
      await expect(outcome).resolves.toEqual({ status: 'denied', by: 'user' });
    }
  });

  it('does not let the initiator approve a human-only tool', async () => {
    const f = setup('alice');
    const port = createRuntimeApprovalPort({ isMaster: false, interaction: f.interaction, selfApproval: true });
    await expect(port.requestApprovalOutcome(request({ humanOnly: true })))
      .resolves.toMatchObject({ status: 'unavailable', reason: expect.stringContaining('bot owner') });
    expect(f.prompts).toHaveLength(0);
  });

  it('times out to a non-approval when nobody answers', async () => {
    const f = setup('alice');
    const port = createRuntimeApprovalPort({ isMaster: false, interaction: f.interaction, selfApproval: true });
    await expect(port.requestApprovalOutcome(request({ timeoutMs: 30 }))).resolves.toEqual({ status: 'timed_out' });
    // A late answer settles nothing.
    expect(f.reply('alice', '确认')).toBe(false);
  });

  it('ignores the same sender in another conversation, endpoint or thread', async () => {
    const f = setup('alice', conversation('group', 'room'));
    const port = createRuntimeApprovalPort({ isMaster: false, interaction: f.interaction, selfApproval: true });
    const outcome = port.requestApprovalOutcome(request());
    await vi.waitFor(() => expect(f.prompts).toHaveLength(1));
    expect(f.reply('alice', '确认', { conversation: { ...f.source.conversation, id: 'other-room' } })).toBe(false);
    expect(f.reply('alice', '确认', { conversation: { ...f.source.conversation, endpoint: { adapter: 'fixture', id: 'other-bot' } } })).toBe(false);
    expect(f.reply('alice', '确认', { conversation: { ...f.source.conversation, threadId: 'topic' } })).toBe(false);
    expect(f.reply('alice', '取消')).toBe(true);
    await expect(outcome).resolves.toEqual({ status: 'denied', by: 'user' });
  });

  it('does not let a replayed button from an earlier prompt approve a new request', async () => {
    const f = setup('alice');
    const port = createRuntimeApprovalPort({ isMaster: false, interaction: f.interaction, selfApproval: true });
    const first = port.requestApprovalOutcome(request({ requestId: 'turn:first' }));
    await vi.waitFor(() => expect(f.prompts).toHaveLength(1));
    const [, approveFirst] = buttonPayloads(f.prompts[0]);
    expect(f.reply('alice', '取消')).toBe(true);
    await expect(first).resolves.toEqual({ status: 'denied', by: 'user' });

    const second = port.requestApprovalOutcome(request({ requestId: 'turn:second' }));
    await vi.waitFor(() => expect(f.prompts).toHaveLength(2));
    expect(f.reply('alice', '', { segments: [{ type: 'action', data: { payload: approveFirst } }] })).toBe(false);
    const [, approveSecond] = buttonPayloads(f.prompts[1]);
    expect(approveSecond).not.toBe(approveFirst);
    expect(f.reply('alice', '', { segments: [{ type: 'action', data: { payload: approveSecond } }] })).toBe(true);
    await expect(second).resolves.toEqual({ status: 'approved', decision: 'approve-once' });
  });
});

describe('initiator intent confirmation when nobody with authority can be asked', () => {
  it('settles only intent requests, reported as intent-only', async () => {
    const f = setup('carol');
    const port = createRuntimeApprovalPort({
      isMaster: false,
      intentInteraction: f.interaction,
      unavailableReason: 'no bot owner is configured for this account, so nobody can approve it here',
    });
    expect(port.available).toBe(true);
    await expect(port.requestApprovalOutcome(request({ purpose: 'authorization' })))
      .resolves.toEqual({ status: 'unavailable', reason: 'no bot owner is configured for this account, so nobody can approve it here' });
    await expect(port.requestApprovalOutcome(request({ purpose: 'intent', humanOnly: true })))
      .resolves.toMatchObject({ status: 'unavailable' });
    expect(f.prompts).toHaveLength(0);

    const outcome = port.requestApprovalOutcome(request({ purpose: 'intent' }));
    await vi.waitFor(() => expect(f.prompts).toHaveLength(1));
    expect(f.reply('mallory', 'yes')).toBe(false);
    expect(f.reply('carol', 'yes')).toBe(true);
    await expect(outcome).resolves.toEqual({ status: 'approved', decision: 'approve-once', scope: 'intent' });
  });

  it('reports a port with nobody to ask as unavailable', () => {
    expect(createRuntimeApprovalPort({ isMaster: false }).available).toBe(false);
  });
});

describe('approval prompts are marked for the surface', () => {
  it.each([
    ['authority', { interaction: true }],
    ['self', { interaction: true, selfApproval: true }],
    ['intent', { intentInteraction: true }],
  ] as const)('passes purpose approval (%s)', async (_name, shape) => {
    const ask = vi.fn(async () => 'approve-once' as never);
    const fake = { ask, sequence: async () => ({}) as never };
    const port = createRuntimeApprovalPort({
      isMaster: false,
      ...('interaction' in shape ? { interaction: fake } : {}),
      ...('selfApproval' in shape ? { selfApproval: true } : {}),
      ...('intentInteraction' in shape ? { intentInteraction: fake } : {}),
    });
    await port.requestApprovalOutcome(request({ purpose: 'intent' }));
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'approval' }));
  });
});

describe('master after external content (#1250)', () => {
  it('asks the master once instead of the exemption, and ignores anyone else', async () => {
    const f = setup('boss', conversation('group', 'room'));
    const memory = { recall: vi.fn(() => true), remember: vi.fn() };
    const port = createRuntimeApprovalPort({ isMaster: true, interaction: f.interaction, memory });
    const outcome = port.requestApprovalOutcome(request({ purpose: 'intent', conversationScope: 'group' }));
    await vi.waitFor(() => expect(f.prompts).toHaveLength(1));
    expect(JSON.stringify(f.prompts[0])).not.toContain('始终允许');
    expect(buttonPayloads(f.prompts[0])).toHaveLength(2);
    expect(f.reply('mallory', '确认')).toBe(false);
    expect(f.reply('mallory', '', { segments: [{ type: 'action', data: { payload: buttonPayloads(f.prompts[0])[1] } }] })).toBe(false);
    expect(f.reply('boss', '确认')).toBe(true);
    await expect(outcome).resolves.toEqual({ status: 'approved', decision: 'approve-once' });
    expect(memory.recall).not.toHaveBeenCalled();
    expect(memory.remember).not.toHaveBeenCalled();
  });

  it('counts silence as a refusal', async () => {
    const f = setup('boss');
    const port = createRuntimeApprovalPort({ isMaster: true, interaction: f.interaction });
    await expect(port.requestApprovalOutcome(request({ purpose: 'intent', timeoutMs: 30 }))).resolves.toEqual({ status: 'timed_out' });
  });

  it('refuses without asking when the master did not address the bot in this turn', async () => {
    const f = setup('boss');
    const port = createRuntimeApprovalPort({ isMaster: true, interaction: f.interaction, masterPresent: false });
    await expect(port.requestApprovalOutcome(request({ purpose: 'intent' })))
      .resolves.toMatchObject({ status: 'unavailable', reason: expect.stringContaining('did not address the bot') });
    expect(f.prompts).toHaveLength(0);
  });

  it('keeps the exemption for ordinary authorization requests', async () => {
    const f = setup('boss');
    const port = createRuntimeApprovalPort({ isMaster: true, interaction: f.interaction });
    await expect(port.requestApprovalOutcome(request({ purpose: 'authorization' })))
      .resolves.toEqual({ status: 'approved', decision: 'approve-always' });
    await expect(port.requestApprovalOutcome(request()))
      .resolves.toEqual({ status: 'approved', decision: 'approve-always' });
    expect(f.prompts).toHaveLength(0);
  });
});
