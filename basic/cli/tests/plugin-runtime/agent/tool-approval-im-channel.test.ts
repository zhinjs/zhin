import { describe, expect, it, vi } from 'vitest';
import {
  ToolApprovalQueue,
  resolveToolHardGateImApproval,
  type ToolApprovalEnqueueInput,
  type ToolHardGateImApprovalConfig,
} from '@zhin.js/agent/security';
import {
  ImToolApprovalChannel,
  formatImApprovalCard,
  imApprovalOperatorId,
  type ImApprovalCommandInput,
  type ImApprovalDeliveryTarget,
} from '../../../src/plugin-runtime/agent/tool-approval-im-channel.js';
import { HostToolApprovals } from '../../../src/plugin-runtime/console/tool-approvals.js';

const BUSINESS_GROUP = '42';

const DANGEROUS_CALL: ToolApprovalEnqueueInput = {
  toolName: 'group_kick',
  category: 'member',
  sessionKey: 'icqq:10001:group:42',
  requesterId: 'member-7',
  turnId: 'turn-1',
  args: { group_id: 42, user_id: 9, cookie: 'SESSDATA=abc123' },
  origin: { platform: 'icqq', endpointKey: '10001', scope: 'group', sceneId: BUSINESS_GROUP },
};

function setup(config: ToolHardGateImApprovalConfig = { enabled: true, approverIds: { icqq: ['admin-1', 'admin-2'] } }) {
  const queue = new ToolApprovalQueue();
  const sent: Array<{ target: ImApprovalDeliveryTarget; text: string }> = [];
  const send = vi.fn(async (target: ImApprovalDeliveryTarget, text: string) => {
    sent.push({ target, text });
  });
  let settings = resolveToolHardGateImApproval(config);
  const channel = new ImToolApprovalChannel({ queue, settings: () => settings, send });
  const stop = channel.start();
  return {
    queue,
    channel,
    sent,
    send,
    stop,
    reconfigure(next: ToolHardGateImApprovalConfig) {
      settings = resolveToolHardGateImApproval(next);
    },
  };
}

function command(text: string, overrides: Partial<ImApprovalCommandInput> = {}): ImApprovalCommandInput {
  return {
    platform: 'icqq',
    scope: 'private',
    sceneId: 'admin-1',
    senderId: 'admin-1',
    commandText: text,
    ...overrides,
  };
}

describe('ImToolApprovalChannel delivery', () => {
  it('sends each new card privately to every approver of its platform, through the Endpoint that saw the call', async () => {
    const { queue, channel, sent } = setup();
    const card = queue.enqueue(DANGEROUS_CALL);
    await channel.drain();

    expect(sent.map((item) => item.target)).toEqual([
      { platform: 'icqq', endpointKey: '10001', conversation: { kind: 'private', id: 'admin-1' } },
      { platform: 'icqq', endpointKey: '10001', conversation: { kind: 'private', id: 'admin-2' } },
    ]);
    const text = sent[0]!.text;
    expect(text).toContain('group_kick');
    expect(text).toContain('成员管理');
    expect(text).toContain(`icqq group:${BUSINESS_GROUP}`);
    expect(text).toContain(card.id);
    expect(text).toContain(`/approve ${card.id}`);
    expect(text).toContain(`/deny ${card.id}`);
    expect(text).toContain('[redacted]');
    expect(text).not.toContain('abc123');
  });

  it('does not re-send a reused card', async () => {
    const { queue, channel, send } = setup();
    queue.enqueue(DANGEROUS_CALL);
    queue.enqueue(DANGEROUS_CALL);
    await channel.drain();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('sends nothing while the channel is off, without approvers for the platform, or without an origin', async () => {
    const off = setup({ enabled: false, approverIds: ['admin-1'] });
    off.queue.enqueue(DANGEROUS_CALL);
    await off.channel.drain();
    expect(off.send).not.toHaveBeenCalled();

    const otherPlatform = setup({ enabled: true, approverIds: { discord: ['admin-1'] } });
    otherPlatform.queue.enqueue(DANGEROUS_CALL);
    await otherPlatform.channel.drain();
    expect(otherPlatform.send).not.toHaveBeenCalled();

    const noOrigin = setup();
    const { origin: _origin, ...withoutOrigin } = DANGEROUS_CALL;
    const card = noOrigin.queue.enqueue(withoutOrigin);
    await expect(noOrigin.channel.deliver(card)).resolves.toEqual({ status: 'unavailable', delivered: 0, attempted: 0 });
  });

  it('posts to the dedicated approver group, but never into the conversation that triggered the call', async () => {
    const group = setup({ enabled: true, approverIds: ['admin-1'], delivery: 'approver_group', approverGroupId: '77' });
    group.queue.enqueue(DANGEROUS_CALL);
    await group.channel.drain();
    expect(group.sent.map((item) => item.target.conversation)).toEqual([{ kind: 'group', id: '77' }]);

    const sameGroup = setup({ enabled: true, approverIds: ['admin-1'], delivery: 'approver_group', approverGroupId: BUSINESS_GROUP });
    sameGroup.queue.enqueue(DANGEROUS_CALL);
    await sameGroup.channel.drain();
    expect(sameGroup.send).not.toHaveBeenCalled();

    const groupless = setup({ enabled: true, approverIds: ['admin-1'], delivery: 'approver_group' });
    groupless.queue.enqueue(DANGEROUS_CALL);
    await groupless.channel.drain();
    expect(groupless.send).not.toHaveBeenCalled();
  });

  it('reports partial delivery and keeps the card pending when a send fails', async () => {
    const queue = new ToolApprovalQueue();
    const onDeliveryError = vi.fn();
    const send = vi.fn(async (target: ImApprovalDeliveryTarget) => {
      if (target.conversation.id === 'admin-2') throw new Error('blocked by user');
    });
    const channel = new ImToolApprovalChannel({
      queue,
      settings: () => resolveToolHardGateImApproval({ enabled: true, approverIds: ['admin-1', 'admin-2'] }),
      send,
      onDeliveryError,
    });
    const card = queue.enqueue(DANGEROUS_CALL);

    await expect(channel.deliver(card)).resolves.toEqual({ status: 'partial', delivered: 1, attempted: 2 });
    expect(onDeliveryError).toHaveBeenCalledTimes(1);
    expect(queue.get(card.id)?.status).toBe('pending');
  });

  it('stops delivering once stopped', async () => {
    const { queue, channel, send, stop } = setup();
    stop();
    queue.enqueue(DANGEROUS_CALL);
    await channel.drain();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('ImToolApprovalChannel commands', () => {
  it('ignores anything that is not a hard-gate card command, so owner /approve keeps working', () => {
    const { channel } = setup();
    expect(channel.handleCommand(command('approve list'))).toBeNull();
    expect(channel.handleCommand(command('approve always bash'))).toBeNull();
    expect(channel.handleCommand(command('approve rule ls'))).toBeNull();
    expect(channel.handleCommand(command(undefined as unknown as string))).toBeNull();
    expect(channel.handleCommand({ ...command('x'), commandText: undefined })).toBeNull();
  });

  it('lets an allowlisted approver approve once from a private chat, recorded as im_dm with the real operator', () => {
    const { queue, channel } = setup();
    const card = queue.enqueue(DANGEROUS_CALL);

    const reply = channel.handleCommand(command(`approve ${card.id}`));

    expect(reply).toContain('已批准');
    expect(queue.get(card.id)).toMatchObject({ status: 'approved', channel: 'im_dm', decidedBy: imApprovalOperatorId('icqq', 'admin-1') });
    expect(imApprovalOperatorId('icqq', 'admin-1')).toBe('im:icqq:admin-1');
  });

  it('lets an allowlisted approver deny from a private chat', () => {
    const { queue, channel } = setup();
    const card = queue.enqueue(DANGEROUS_CALL);
    expect(channel.handleCommand(command(`DENY ${card.id}`, { senderId: 'admin-2', sceneId: 'admin-2' }))).toContain('已拒绝');
    expect(queue.get(card.id)).toMatchObject({ status: 'denied', channel: 'im_dm', decidedBy: 'im:icqq:admin-2' });
  });

  it('never settles a card from a business group, even for an approver', () => {
    const { queue, channel } = setup();
    const card = queue.enqueue(DANGEROUS_CALL);

    const inBusinessGroup = channel.handleCommand(command(`approve ${card.id}`, { scope: 'group', sceneId: BUSINESS_GROUP }));
    const inOtherGroup = channel.handleCommand(command(`approve ${card.id}`, { scope: 'group', sceneId: '99' }));
    const inChannel = channel.handleCommand(command(`approve ${card.id}`, { scope: 'channel', sceneId: '5' }));

    expect(inBusinessGroup).toContain('私聊');
    expect(inOtherGroup).toContain('私聊');
    expect(inChannel).toContain('私聊');
    expect(queue.get(card.id)?.status).toBe('pending');
  });

  it('refuses users who are not on the allowlist, and approvers of another platform', () => {
    const { queue, channel } = setup();
    const card = queue.enqueue(DANGEROUS_CALL);

    expect(channel.handleCommand(command(`approve ${card.id}`, { senderId: 'member-7', sceneId: 'member-7' }))).toContain('不在');
    expect(channel.handleCommand(command(`approve ${card.id}`, { platform: 'discord' }))).toContain('不在');
    expect(queue.get(card.id)?.status).toBe('pending');
  });

  it('does not settle a card from another platform even for a cross-platform approver', () => {
    const { queue, channel } = setup({ enabled: true, approverIds: ['admin-1'] });
    const card = queue.enqueue(DANGEROUS_CALL);
    expect(channel.handleCommand(command(`approve ${card.id}`, { platform: 'discord' }))).toContain('未找到');
    expect(queue.get(card.id)?.status).toBe('pending');
  });

  it('answers but does not settle while the channel is off', () => {
    const { queue, channel } = setup({ enabled: false, approverIds: ['admin-1'] });
    const card = queue.enqueue(DANGEROUS_CALL);
    expect(channel.handleCommand(command(`approve ${card.id}`))).toContain('未开启');
    expect(queue.get(card.id)?.status).toBe('pending');
  });

  it('accepts commands in the configured approver group as im_approver_group', () => {
    const { queue, channel } = setup({ enabled: true, approverIds: ['admin-1'], delivery: 'approver_group', approverGroupId: '77' });
    const card = queue.enqueue(DANGEROUS_CALL);

    expect(channel.handleCommand(command(`approve ${card.id}`, { scope: 'group', sceneId: BUSINESS_GROUP }))).toContain('审批群');
    expect(channel.handleCommand(command(`approve ${card.id}`, { scope: 'group', sceneId: '77' }))).toContain('已批准');
    expect(queue.get(card.id)).toMatchObject({ status: 'approved', channel: 'im_approver_group', decidedBy: 'im:icqq:admin-1' });
  });

  it('never lets the triggering group settle its own card, even if it is misconfigured as the approver group', () => {
    const { queue, channel } = setup({ enabled: true, approverIds: ['admin-1'], delivery: 'approver_group', approverGroupId: BUSINESS_GROUP });
    const card = queue.enqueue(DANGEROUS_CALL);
    expect(channel.handleCommand(command(`approve ${card.id}`, { scope: 'group', sceneId: BUSINESS_GROUP }))).toContain('触发');
    expect(queue.get(card.id)?.status).toBe('pending');
  });

  it('reports unknown and already-decided cards without changing them', () => {
    const { queue, channel } = setup();
    const card = queue.enqueue(DANGEROUS_CALL);
    expect(channel.handleCommand(command('approve tap_missing_1'))).toContain('未找到');
    channel.handleCommand(command(`deny ${card.id}`));
    expect(channel.handleCommand(command(`approve ${card.id}`))).toContain('已拒绝');
    expect(queue.get(card.id)).toMatchObject({ status: 'denied' });
  });

  it('applies a config reload to the next command', () => {
    const { queue, channel, reconfigure } = setup();
    const card = queue.enqueue(DANGEROUS_CALL);
    reconfigure({ enabled: true, approverIds: { icqq: ['admin-2'] } });
    expect(channel.handleCommand(command(`approve ${card.id}`))).toContain('不在');
    expect(queue.get(card.id)?.status).toBe('pending');
  });
});

describe('IM × Console on the same queue (G6-c)', () => {
  it('Console first: the IM answer sees the card as decided', () => {
    const { queue, channel } = setup();
    const approvals = new HostToolApprovals(queue);
    const card = queue.enqueue(DANGEROUS_CALL);

    expect(approvals.resolve({ id: card.id, decision: 'deny' })).toMatchObject({ status: 'denied', channel: 'console', decidedBy: 'console' });
    expect(channel.handleCommand(command(`approve ${card.id}`))).toContain('已拒绝');
    expect(queue.get(card.id)).toMatchObject({ status: 'denied', channel: 'console' });
  });

  it('IM first: the Console answer is a conflict', () => {
    const { queue, channel } = setup();
    const approvals = new HostToolApprovals(queue);
    const card = queue.enqueue(DANGEROUS_CALL);

    channel.handleCommand(command(`approve ${card.id}`));

    expect(() => approvals.resolve({ id: card.id, decision: 'deny' })).toThrow(/already approved/);
    expect(approvals.snapshot().recent[0]).toMatchObject({ id: card.id, status: 'approved', channel: 'im_dm', decidedBy: 'im:icqq:admin-1' });
  });

  it('keeps timeouts as denials: an expired card cannot be approved over IM', () => {
    vi.useFakeTimers();
    try {
      const queue = new ToolApprovalQueue({ ttlMs: 1_000 });
      const channel = new ImToolApprovalChannel({
        queue,
        settings: () => resolveToolHardGateImApproval({ enabled: true, approverIds: ['admin-1'] }),
        send: async () => undefined,
      });
      const card = queue.enqueue(DANGEROUS_CALL);
      vi.advanceTimersByTime(1_001);
      expect(channel.handleCommand(command(`approve ${card.id}`))).toContain('已过期');
      expect(queue.get(card.id)).toMatchObject({ status: 'expired', channel: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps restart behavior: cards from a previous process are unknown to the new queue', () => {
    const before = setup();
    const card = before.queue.enqueue(DANGEROUS_CALL);
    before.queue.dispose();
    const after = setup();
    expect(after.channel.handleCommand(command(`approve ${card.id}`))).toContain('未找到');
    expect(before.queue.get(card.id)?.status).toBe('expired');
  });
});

describe('formatImApprovalCard', () => {
  it('truncates long arguments and mentions the Console fallback', () => {
    const queue = new ToolApprovalQueue();
    const card = queue.enqueue({ ...DANGEROUS_CALL, args: { reason: 'x'.repeat(1_000) } });
    const text = formatImApprovalCard(card, 'dm');
    expect(text).toContain('…');
    expect(text.length).toBeLessThan(800);
    expect(text).toContain('Console');
  });
});

describe('ImToolApprovalChannel self-change cards (ADR 0040 §4)', () => {
  const SELF_CHANGE: ToolApprovalEnqueueInput = {
    toolName: 'self_change',
    category: 'self',
    sessionKey: 'self-change:icqq:group:42',
    requesterId: 'owner-1',
    turnId: 'turn-9',
    args: {
      changeId: 'c-1',
      contentHash: 'sha256:abc',
      summary: '加一个 /ping 指令',
      files: [{ path: 'commands/ping.ts', kind: 'create', added: 2, removed: 0 }],
      configPaths: [],
      impact: 'generation',
      impactDetail: ['reload app'],
      trial: 'passed',
    },
    origin: { platform: 'icqq', endpointKey: '10001', scope: 'group', sceneId: BUSINESS_GROUP },
  };

  function selfSetup(config: ToolHardGateImApprovalConfig = { enabled: false }) {
    const queue = new ToolApprovalQueue();
    const sent: Array<{ target: ImApprovalDeliveryTarget; text: string }> = [];
    const send = vi.fn(async (target: ImApprovalDeliveryTarget, text: string) => { sent.push({ target, text }); });
    const channel = new ImToolApprovalChannel({
      queue,
      settings: () => resolveToolHardGateImApproval(config),
      send,
      resolveOwner: (platform, endpointKey) => platform === 'icqq' && endpointKey === '10001' ? 'owner-1' : undefined,
    });
    channel.start();
    return { queue, channel, sent, send };
  }

  it('delivers a group-started change to the owner privately, even with the G6 channel off', async () => {
    const { queue, channel, sent } = selfSetup();
    const card = queue.enqueue(SELF_CHANGE);
    await channel.drain();
    expect(sent.map((item) => item.target.conversation)).toEqual([{ kind: 'private', id: 'owner-1' }]);
    const text = sent[0]!.text;
    expect(text).toContain('【变更审批】加一个 /ping 指令');
    expect(text).toContain('create commands/ping.ts（+2 -0）');
    expect(text).toContain('影响：热重载（reload app）');
    expect(text).toContain('试跑：通过');
    expect(text).toContain(`/approve ${card.id}`);
    expect(text).not.toContain('contentHash');
  });

  it('adds allowlisted approvers when G6 is on, without sending the owner twice', async () => {
    const { queue, channel, sent } = selfSetup({ enabled: true, approverIds: ['owner-1', 'admin-1'] });
    queue.enqueue(SELF_CHANGE);
    await channel.drain();
    expect(sent.map((item) => item.target.conversation.id).sort()).toEqual(['admin-1', 'owner-1']);
  });

  it('lets the owner settle in a private chat but never in the business group', async () => {
    const { queue, channel } = selfSetup();
    const card = queue.enqueue(SELF_CHANGE);
    expect(channel.handleCommand(command(`approve ${card.id}`, { scope: 'group', sceneId: BUSINESS_GROUP, senderId: 'owner-1' })))
      .toContain('群内消息不会结算');
    expect(queue.get(card.id)?.status).toBe('pending');
    expect(channel.handleCommand(command(`approve ${card.id}`, { sceneId: 'stranger', senderId: 'stranger' })))
      .toContain('IM 审批通道未开启');
    expect(channel.handleCommand(command(`approve ${card.id}`, { sceneId: 'owner-1', senderId: 'owner-1' })))
      .toBe(`已批准变更 c-1（${card.id}）。`);
    expect(queue.get(card.id)).toMatchObject({ status: 'approved', channel: 'im_dm', decidedBy: imApprovalOperatorId('icqq', 'owner-1') });
  });

  it('does not let the owner settle ordinary hard-gate cards while G6 is off', () => {
    const { queue, channel } = selfSetup();
    const card = queue.enqueue(DANGEROUS_CALL);
    expect(channel.handleCommand(command(`approve ${card.id}`, { sceneId: 'owner-1', senderId: 'owner-1' })))
      .toContain('IM 审批通道未开启');
    expect(queue.get(card.id)?.status).toBe('pending');
  });

  it('formats the self-change card through formatImApprovalCard', () => {
    const queue = new ToolApprovalQueue();
    const card = queue.enqueue(SELF_CHANGE);
    expect(formatImApprovalCard(card, 'dm')).toContain('【变更审批】');
  });
});
