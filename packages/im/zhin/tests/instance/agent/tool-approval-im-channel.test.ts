import { describe, expect, it, vi } from 'vitest';
import { managementCommandText } from '@zhin.js/agent';
import {
  ToolApprovalQueue,
  resolveToolHardGateImApproval,
  type ToolApprovalEnqueueInput,
  type ToolHardGateImApprovalConfig,
} from '@zhin.js/agent/security';
import {
  ImToolApprovalChannel,
  formatImApprovalCard,
  formatSelfChangeCard,
  imApprovalOperatorId,
  type ImApprovalCommandInput,
  type ImApprovalDeliveryTarget,
} from '@zhin.js/agent/runtime';
import type { SendContent } from '@zhin.js/core';
import { renderTemplatePaths } from '@zhin.js/kernel';
import { componentHostToken, type ComponentHost, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { OutboundRenderer } from '../../../../core/src/plugin-runtime/im/outbound-renderer.js';
import { HostToolApprovals } from '../../../src/instance/console/tool-approvals.js';
import { cardText, literalPieces } from './card-text.js';

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

function setup(
  config: ToolHardGateImApprovalConfig = { enabled: true, approverIds: { icqq: ['admin-1', 'admin-2'] } },
  // #1250: the recipient Endpoint's command presentation; these fixtures model an Endpoint with prefix `/`.
  resolvePresentation: ConstructorParameters<typeof ImToolApprovalChannel>[0]['resolvePresentation'] = () => ({ commandPrefix: '/' }),
) {
  const queue = new ToolApprovalQueue();
  const sent: Array<{ target: ImApprovalDeliveryTarget; text: string }> = [];
  const send = vi.fn(async (target: ImApprovalDeliveryTarget, content: SendContent) => {
    sent.push({ target, text: cardText(content) });
  });
  let settings = resolveToolHardGateImApproval(config);
  const channel = new ImToolApprovalChannel({ queue, settings: () => settings, send, ...(resolvePresentation ? { resolvePresentation } : {}) });
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

  it('flags refusals of senders who could settle no card, never an approver\'s venue or card mistakes (#1250)', () => {
    const { queue, channel } = setup();
    const card = queue.enqueue(DANGEROUS_CALL);
    const flagged = (overrides: Partial<ImApprovalCommandInput>, text = `approve ${card.id}`) => {
      const onUnauthorized = vi.fn();
      const reply = channel.handleCommand(command(text, { ...overrides, onUnauthorized }));
      return { reply, reasons: onUnauthorized.mock.calls.map(call => call[0]) };
    };
    // A member in a group (the ingress stays silent there) and in a private chat (the ingress explains).
    expect(flagged({ senderId: 'member-7', scope: 'group', sceneId: BUSINESS_GROUP })).toMatchObject({ reasons: ['not_approver'] });
    expect(flagged({ senderId: 'member-7', sceneId: 'member-7' })).toMatchObject({ reasons: ['not_approver'] });
    // An approver in the wrong venue or with a wrong id is told so.
    expect(flagged({ scope: 'group', sceneId: BUSINESS_GROUP })).toMatchObject({ reasons: [] });
    expect(flagged({}, 'approve tap_missing')).toMatchObject({ reasons: [] });
    expect(queue.get(card.id)?.status).toBe('pending');
    expect(flagged({})).toMatchObject({ reasons: [] });
    expect(flagged({})).toMatchObject({ reasons: [] });
  });

  it('flags a non-approver while the channel is off, but not an approver (#1250)', () => {
    const { queue, channel } = setup({ enabled: false, approverIds: ['admin-1'] });
    const card = queue.enqueue(DANGEROUS_CALL);
    const member = vi.fn();
    expect(channel.handleCommand(command(`approve ${card.id}`, { senderId: 'member-7', scope: 'group', sceneId: '5', onUnauthorized: member }))).toContain('未开启');
    expect(member).toHaveBeenCalledWith('not_approver');
    // `isImApprover` needs the channel on: a listed approver while it is off is refused like anyone else.
    const approver = vi.fn();
    channel.handleCommand(command(`approve ${card.id}`, { onUnauthorized: approver }));
    expect(approver).toHaveBeenCalledWith('not_approver');
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
    const text = cardText(formatImApprovalCard(card, 'dm'));
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
    const send = vi.fn(async (target: ImApprovalDeliveryTarget, content: SendContent) => { sent.push({ target, text: cardText(content) }); });
    const channel = new ImToolApprovalChannel({
      queue,
      settings: () => resolveToolHardGateImApproval(config),
      send,
      resolveOwner: (platform, endpointKey) => platform === 'icqq' && endpointKey === '10001' ? 'owner-1' : undefined,
      resolvePresentation: () => ({ commandPrefix: '/' }),
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
    expect(cardText(formatImApprovalCard(card, 'dm'))).toContain('【变更审批】');
  });

  it('shows the diff excerpt, the skipped check names and the blind-approval warning (#1142 F3)', () => {
    const queue = new ToolApprovalQueue();
    const card = queue.enqueue({
      ...SELF_CHANGE,
      args: {
        ...SELF_CHANGE.args,
        trial: 'passed (1 skipped)',
        skippedChecks: ['sandbox_load commands/ping.ts'],
        diffExcerpt: ['# create commands/ping.ts', '@@ -0,0 +1,1 @@', '+export default 1;'],
        diffExcerptTruncated: false,
      },
    });
    const text = cardText(formatImApprovalCard(card, 'dm'));
    // Each excerpt line is quoted (`│ `), so it cannot pass for a line of the card itself (#1250).
    expect(text).toContain('差异摘录：\n│ # create commands/ping.ts\n│ @@ -0,0 +1,1 @@\n│ +export default 1;\n（以上为全部改动）');
    expect(text).toContain('试跑：通过 (1 skipped)；跳过：sandbox_load commands/ping.ts');
    expect(text).toContain('未看完整正文请去 Console');
  });

  it('says how many skipped checks were left off the card', () => {
    const queue = new ToolApprovalQueue();
    const card = queue.enqueue({
      ...SELF_CHANGE,
      args: { ...SELF_CHANGE.args, trial: 'passed (21 skipped)', skippedChecks: ['syntax a.tsx'], skippedChecksOmitted: 20 },
    });
    expect(cardText(formatSelfChangeCard(card))).toContain('跳过：syntax a.tsx，…另 20 项（见 Console）');
  });

  it('caps a stored excerpt at exactly 40 short lines', () => {
    const queue = new ToolApprovalQueue();
    const shortLines = Array.from({ length: 45 }, (_, index) => `+l${index}`);
    const card = queue.enqueue({
      ...SELF_CHANGE,
      args: { ...SELF_CHANGE.args, diffExcerpt: shortLines, diffExcerptTruncated: false },
    });
    const text = cardText(formatSelfChangeCard(card));
    const shown = text.split('\n').filter(line => /^│ \+l\d+$/u.test(line));
    expect(shown).toHaveLength(40);
    expect(shown.at(-1)).toBe('│ +l39');
    expect(text).toContain('…（摘录已截断）完整内容见 Console。');
  });

  it('says there are no body changes for an empty excerpt (config-only change)', () => {
    const queue = new ToolApprovalQueue();
    const card = queue.enqueue({
      ...SELF_CHANGE,
      args: { ...SELF_CHANGE.args, files: [], configPaths: ['set ping.greeting'], diffExcerpt: [] },
    });
    const text = cardText(formatSelfChangeCard(card));
    expect(text).toContain('差异摘录：无文件正文改动。');
    expect(text).toContain('配置：set ping.greeting');
    expect(text).not.toContain('不可用');
  });

  it('caps a stored excerpt at 2 KB and points to the Console', () => {
    const queue = new ToolApprovalQueue();
    const longLines = Array.from({ length: 45 }, (_, index) => `+line ${index} ${'z'.repeat(150)}`);
    const card = queue.enqueue({
      ...SELF_CHANGE,
      args: { ...SELF_CHANGE.args, diffExcerpt: longLines, diffExcerptTruncated: false },
    });
    const text = cardText(formatSelfChangeCard(card));
    const shown = text.split('\n').filter(line => line.startsWith('+line '));
    expect(shown.length).toBeLessThan(40);
    expect(Buffer.byteLength(shown.join('\n'), 'utf8')).toBeLessThanOrEqual(2 * 1024);
    expect(text).toContain('…（摘录已截断）完整内容见 Console。');
  });

  it('still warns when the card has no excerpt (older or failed excerpt)', () => {
    const queue = new ToolApprovalQueue();
    const card = queue.enqueue(SELF_CHANGE);
    const text = cardText(formatSelfChangeCard(card));
    expect(text).toContain('差异摘录：不可用，完整内容见 Console。');
    expect(text).toContain('未看完整正文请去 Console');
    expect(text).toContain('试跑：通过');
    expect(text).not.toContain('跳过：');
  });
});

/** The command a recipient copies from a card line such as `批准：<command>` / `Approve: <command>`. */
function cardCommand(text: string, label: RegExp): string {
  const line = text.split('\n').find(item => label.test(item));
  if (!line) throw new Error(`no ${label} line in:\n${text}`);
  return line.replace(label, '');
}

describe('IM approval cards spell commands with the recipient\'s real prefix (#1250)', () => {
  for (const prefix of ['', '#', '/']) {
    it(`prefix ${JSON.stringify(prefix)}: the approve command on the card is what the ingress parses and settles`, async () => {
      const { queue, channel, sent } = setup(undefined, () => ({ commandPrefix: prefix }));
      const card = queue.enqueue(DANGEROUS_CALL);
      await channel.drain();
      const text = sent[0]!.text;
      const approve = cardCommand(text, /^批准：/u);
      expect(approve).toBe(`${prefix}approve ${card.id}`);
      expect(text).not.toContain('命令前缀');
      // Ingress: strip the Endpoint's prefix (`managementCommandText`), then the channel's anchored command.
      const reply = channel.handleCommand(command(managementCommandText(approve, prefix) as string));
      expect(reply).toContain('已批准');
      expect(queue.get(card.id)).toMatchObject({ status: 'approved', channel: 'im_dm' });
    });

    it(`prefix ${JSON.stringify(prefix)}: the deny command on a self-change card settles it`, async () => {
      const queue = new ToolApprovalQueue();
      const sent: string[] = [];
      const channel = new ImToolApprovalChannel({
        queue,
        settings: () => resolveToolHardGateImApproval({ enabled: false }),
        send: async (_target, content) => { sent.push(cardText(content)); },
        resolveOwner: () => 'owner-1',
        resolvePresentation: () => ({ commandPrefix: prefix }),
      });
      channel.start();
      const card = queue.enqueue({
        toolName: 'self_change', category: 'self', sessionKey: 's', requesterId: 'owner-1', turnId: 't',
        args: { changeId: 'c-2', summary: 'x', files: [], configPaths: [], impact: 'none', trial: 'passed' },
        origin: { platform: 'icqq', endpointKey: '10001', scope: 'private', sceneId: 'owner-1' },
      });
      await channel.drain();
      const deny = cardCommand(sent[0]!, /^驳回：/u);
      expect(deny).toBe(`${prefix}deny ${card.id}`);
      expect(channel.handleCommand(command(managementCommandText(deny, prefix) as string, { sceneId: 'owner-1', senderId: 'owner-1' })))
        .toBe(`已驳回变更 c-2（${card.id}）。`);
    });
  }

  it('a card command carrying another prefix is not parsed as an approval', async () => {
    const { queue, channel, sent } = setup(undefined, () => ({ commandPrefix: '#' }));
    const card = queue.enqueue(DANGEROUS_CALL);
    await channel.drain();
    expect(managementCommandText(`/approve ${card.id}`, '#')).toBeUndefined();
    expect(cardCommand(sent[0]!.text, /^批准：/u)).toBe(`#approve ${card.id}`);
  });

  it('asks the recipient for this account\'s prefix when the presentation is unknown, never inventing `/`', async () => {
    const { queue, channel, sent } = setup(undefined, () => undefined);
    const card = queue.enqueue(DANGEROUS_CALL);
    await channel.drain();
    const text = sent[0]!.text;
    expect(cardCommand(text, /^批准：/u)).toBe(`approve ${card.id}`);
    expect(text).toContain('（发送时加上本账号的命令前缀）');
    expect(text).not.toContain('/approve');
    const thrown = setup(undefined, () => { throw new Error('no generation'); });
    thrown.queue.enqueue(DANGEROUS_CALL);
    await thrown.channel.drain();
    expect(thrown.sent).toHaveLength(2);
    expect(cardText(formatImApprovalCard(card, 'dm'))).toContain(`批准：approve ${card.id}`);
    expect(cardText(formatImApprovalCard(card, 'dm', { commandPrefix: '#' }))).toContain(`批准：#approve ${card.id}`);
  });

  it('writes each recipient\'s card in their own language, with ISO time', async () => {
    const { queue, channel, sent } = setup(undefined, target => target.conversation.id === 'admin-2'
      ? { locale: 'en', commandPrefix: '!' } : { locale: 'zh-CN', commandPrefix: '!' });
    const card = queue.enqueue(DANGEROUS_CALL);
    await channel.drain();
    const zh = sent.find(item => item.target.conversation.id === 'admin-1')!.text;
    const en = sent.find(item => item.target.conversation.id === 'admin-2')!.text;
    expect(zh).toContain('【危险工具审批】group_kick（成员管理）');
    expect(en).toContain('[Dangerous tool approval] group_kick (member management)');
    expect(en).toContain(`Approve: !approve ${card.id}`);
    expect(en).toContain(`Deny: !deny ${card.id}`);
    expect(en).toMatch(/Expires: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(denied automatically on timeout\)/u);
    expect(en).not.toMatch(/[\u4e00-\u9fff]/u);
    expect(zh).toMatch(/过期时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}（超时自动拒绝）/u);
  });

  it('formats an English self-change card without Chinese', () => {
    const queue = new ToolApprovalQueue();
    const card = queue.enqueue({
      toolName: 'self_change', category: 'self', sessionKey: 's', requesterId: 'owner-1', turnId: 't',
      args: {
        changeId: 'c-3', summary: 'add ping', files: [{ path: 'commands/ping.ts', kind: 'create', added: 2, removed: 0 }],
        configPaths: ['set ping.greeting'], impact: 'generation (estimated)', impactDetail: ['reload app'], trial: 'passed (1 skipped)',
        skippedChecks: ['syntax a.tsx'], skippedChecksOmitted: 2, diffExcerpt: ['+x'], diffExcerptTruncated: true,
      },
      origin: { platform: 'icqq', endpointKey: '10001', scope: 'group', sceneId: BUSINESS_GROUP },
    });
    const text = cardText(formatSelfChangeCard(card, { locale: 'en', commandPrefix: '' }));
    expect(text).toContain('[Change approval] add ping');
    expect(text).toContain('  create commands/ping.ts (+2 -0)');
    expect(text).toContain('Impact: hot reload (estimated) (reload app)');
    expect(text).toContain('Trial run: passed (1 skipped); skipped: syntax a.tsx, …2 more (see the Console)');
    expect(text).toContain('… (excerpt truncated) See the Console for the full change.');
    expect(text).toContain(`Approve: approve ${card.id}`);
    expect(text).toContain(`Reject: deny ${card.id}`);
    expect(text).not.toMatch(/[\u4e00-\u9fff]/u);
  });

  it('answers approve / deny in the sender\'s language', () => {
    const { queue, channel } = setup();
    const card = queue.enqueue(DANGEROUS_CALL);
    expect(channel.handleCommand(command(`approve ${card.id}`, { scope: 'group', sceneId: '99', locale: 'en' })))
      .toBe('Dangerous-tool approvals can only be answered in a private chat with the Bot; messages in a group do not settle approval cards.');
    expect(channel.handleCommand(command(`approve ${card.id}`, { senderId: 'member-7', sceneId: 'member-7', locale: 'en' })))
      .toContain('not on the dangerous-tool approver list');
    expect(channel.handleCommand(command(`approve ${card.id}`, { locale: 'en' })))
      .toBe(`Approved ${card.id} (group_kick). It applies only to this one call with these arguments.`);
    expect(channel.handleCommand(command(`deny ${card.id}`, { locale: 'en' }))).toBe(`Approval card ${card.id} was already approved; nothing to do.`);
    expect(channel.handleCommand(command('approve tap_missing_1', { locale: 'en' }))).toBe('Approval card tap_missing_1 was not found.');
  });
});

describe('IM approval cards keep user / model / plugin text literal (#1250)', () => {
  const rootId = 'plugin:root';
  const host: ComponentHost = { compileTemplate: (text, ctx) => renderTemplatePaths(text, { ...ctx }) };
  const snapshot = {
    root: rootId, projections: new Map(), resources: new Map([[rootId, new Map([[componentHostToken.id, host]])]]),
  } as unknown as RuntimeSnapshot;
  const conversation = { endpoint: { id: 'icqq:10001', adapter: 'icqq' }, kind: 'private' as const, id: 'admin-1' };
  /** What the approver's client receives: the outbound renderer compiles template paths in plain strings. */
  const delivered = async (content: SendContent) => cardText(await new OutboundRenderer().render(content, {
    requester: 'plugin:agent' as never, snapshot, conversation,
  }) as SendContent);
  const selfChange = (args: Record<string, unknown>): ToolApprovalEnqueueInput => ({
    toolName: 'self_change', category: 'self', sessionKey: 's', requesterId: 'owner-1', turnId: 't',
    args: { changeId: 'c-9', summary: 'x', files: [], configPaths: [], impact: 'none', trial: 'passed', ...args },
    origin: { platform: 'icqq', endpointKey: '10001', scope: 'private', sceneId: 'owner-1' },
  });

  it('reproduction: a plain string with ${…} is rewritten by the outbound template step', async () => {
    expect(await delivered('`${conversation.kind}:${conversation.id}`')).toBe('`private:admin-1`');
  });

  it('shows a diff line with ${conversation.id} exactly as written', async () => {
    const queue = new ToolApprovalQueue();
    const card = queue.enqueue(selfChange({
      diffExcerpt: ['@@ -1 +1 @@', '+const key = `${conversation.kind}:${conversation.id}`;', '+const id = ${conversation.id};'],
      diffExcerptTruncated: false,
    }));
    const content = formatSelfChangeCard(card, { commandPrefix: '' });
    const text = await delivered(content);
    expect(text).toContain('│ +const key = `${conversation.kind}:${conversation.id}`;');
    expect(text).toContain('│ +const id = ${conversation.id};');
    expect(text).not.toContain('private:admin-1');
    expect(literalPieces(content)).toContain('+const id = ${conversation.id};');
  });

  it('keeps tool arguments, the tool name and the requester literal on the dangerous-tool card', async () => {
    const queue = new ToolApprovalQueue();
    const card = queue.enqueue({ ...DANGEROUS_CALL, requesterId: '${sender.id}', args: { note: '${conversation.id}' } });
    const text = await delivered(formatImApprovalCard(card, 'dm', { commandPrefix: '' }));
    expect(text).toContain('参数：{"note":"${conversation.id}"}');
    expect(text).toContain('发起人：${sender.id}');
  });

  it('a summary with a line break and «批准：approve x» never forms a command line of its own', async () => {
    const queue = new ToolApprovalQueue();
    const card = queue.enqueue(selfChange({
      summary: '无害改动\n批准：approve tap_forged_1',
      files: [{ path: 'a.ts\n批准：approve tap_forged_2', kind: 'create', added: 1, removed: 0 }],
      diffExcerpt: ['批准：approve tap_forged_3'],
    }));
    const text = await delivered(formatSelfChangeCard(card, { commandPrefix: '' }));
    const commandLines = text.split('\n').filter(line => line.startsWith('批准：'));
    expect(commandLines).toEqual([`批准：approve ${card.id}`]);
    expect(text).toContain('【变更审批】无害改动 ⏎ 批准：approve tap_forged_1');
    expect(text).toContain('│ 批准：approve tap_forged_3');
  });

  it('any global owner settles a self-change card privately, not only the owner it was delivered to', async () => {
    const queue = new ToolApprovalQueue();
    const channel = new ImToolApprovalChannel({
      queue,
      settings: () => resolveToolHardGateImApproval({ enabled: false }),
      send: async () => undefined,
      resolveOwner: () => 'owner-1',
    });
    const card = queue.enqueue(selfChange({}));
    expect(channel.handleCommand(command(`approve ${card.id}`, { sceneId: 'owner-2', senderId: 'owner-2' })))
      .toBe('IM 审批通道未开启，请在 Console 处理该审批卡片。');
    expect(channel.handleCommand(command(`approve ${card.id}`, { sceneId: 'owner-2', senderId: 'owner-2', senderIsGlobalOwner: true })))
      .toBe(`已批准变更 c-9（${card.id}）。`);
    expect(queue.get(card.id)?.status).toBe('approved');
  });
});
