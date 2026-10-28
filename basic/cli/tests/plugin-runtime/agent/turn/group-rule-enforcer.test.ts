import { describe, expect, it, vi } from 'vitest';
import { AiControlPlane, AiGroupRules, DecisionEventLog, type GroupRuleSpecInput } from '@zhin.js/agent';
import { OpsCooldown, ToolApprovalQueue } from '@zhin.js/agent/security';
import {
  GroupRuleEnforcer,
  GROUP_RULE_KICK_TOOL_NAME,
  type GroupRuleViolation,
} from '../../../../src/plugin-runtime/agent/turn/group-rule-enforcer.js';

const scene = { platform: 'icqq', sceneId: 'group:123' };
const remindThenMute: GroupRuleSpecInput = {
  trigger: 'advertising',
  ladder: [{ action: 'remind' }, { action: 'mute', durationSec: 600 }],
  content: '发广告先提醒，再犯禁言十分钟',
};

async function activate(store: AiGroupRules, spec: GroupRuleSpecInput = remindThenMute) {
  const created = await store.create({ ...scene, ...spec, createdBy: 'owner-1', createdVia: 'model' });
  const pending = await store.submit({ id: created.record.id, expectedRevision: created.record.revision, actorId: 'owner-1' });
  const approved = await store.approve({
    id: pending.record.id,
    expectedRevision: pending.record.revision,
    actorId: 'admin-2',
    approvedVia: 'im',
    contentHash: pending.record.contentHash,
  });
  return approved.record;
}

function harness(options: {
  control?: AiControlPlane;
  canModerate?: boolean;
  mute?: () => Promise<void>;
} = {}) {
  let clock = 1_000_000;
  const log = new DecisionEventLog();
  const store = new AiGroupRules({ audit: () => log });
  const queue = new ToolApprovalQueue();
  const cooldown = new OpsCooldown({ now: () => clock });
  const send = vi.fn(async () => ({ status: 'sent' as const }));
  const mute = vi.fn(options.mute ?? (async () => undefined));
  const kick = vi.fn(async () => undefined);
  const inspect = vi.fn(async () => ({ canModerate: options.canModerate ?? true }));
  const enforcer = new GroupRuleEnforcer({
    rules: () => store,
    controlPlane: () => options.control,
    decisionEvents: () => log,
    approvals: () => queue,
    opsCooldown: () => cooldown,
    send,
    inspect,
    mute,
    kick,
    now: () => clock,
  });
  const hit = (overrides: Partial<GroupRuleViolation> = {}) => enforcer.enforce({
    platform: 'icqq',
    endpoint: '10086',
    groupId: '123',
    memberId: 'u-1',
    memberRoles: ['member'],
    trigger: 'advertising',
    sentAt: clock,
    messageId: `m-${clock}`,
    evidence: ['加我微信领优惠'],
    ...overrides,
  });
  const advance = (ms: number) => { clock += ms; };
  const codes = async () => {
    await log.idle();
    return log.recent().map((row) => `${row.kind}:${row.outcome}:${row.reasonCode}`);
  };
  return { store, queue, send, mute, kick, inspect, enforcer, hit, advance, codes, log };
}

describe('GroupRuleEnforcer (ADR 0039 slice C)', () => {
  it('does nothing when the group has no active rule for the trigger', async () => {
    const { hit, send, mute, codes } = harness();
    await expect(hit()).resolves.toEqual({ kind: 'no_rule' });
    expect(send).not.toHaveBeenCalled();
    expect(mute).not.toHaveBeenCalled();
    expect(await codes()).toEqual([]);
  });

  it('reminds first, then auto-mutes on the second hit with no approval card (acceptance 3)', async () => {
    const { store, queue, hit, advance, send, mute, codes, log } = harness();
    const rule = await activate(store);
    const enqueue = vi.spyOn(queue, 'enqueue');

    await expect(hit()).resolves.toMatchObject({ kind: 'enforced', action: 'remind', stage: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual([
      { platform: 'icqq', endpoint: '10086', groupId: '123' },
      [{ type: 'mention', id: 'u-1' }, expect.objectContaining({ type: 'text', text: expect.stringContaining('提醒') })],
    ]);

    advance(5_000);
    await expect(hit()).resolves.toMatchObject({ kind: 'enforced', action: 'mute', stage: 2 });
    expect(mute).toHaveBeenCalledWith({ platform: 'icqq', endpoint: '10086', groupId: '123' }, 'u-1', 600, expect.any(AbortSignal));
    expect(enqueue).not.toHaveBeenCalled();
    expect(await codes()).toEqual(expect.arrayContaining([
      'rule_enforcement:allow:rule_hit_remind',
      'ops_cooldown:allow:ops_cooldown_passed',
      'tool_approval:allow:tool_approval_approved',
      'tool_hard_gate:allow:tool_approval_approved',
      'rule_enforcement:allow:rule_hit_mute',
    ]));
    // Replay: the mute traces back to the rule and its approver.
    const approval = log.recent().find((row) => row.kind === 'tool_approval');
    expect(approval).toMatchObject({ actor: 'operator', actorId: 'admin-2' });
    expect(approval!.payload).toMatchObject({ via: 'rule', approvalId: rule.id, channel: 'im_group', tool: 'mute_member' });
    const mutedRow = log.recent().find((row) => row.reasonCode === 'rule_hit_mute');
    expect(mutedRow!.turnId).toBe(approval!.turnId);
    expect(mutedRow!.payload).toMatchObject({ ruleId: rule.id, approvedBy: 'admin-2', evidence: ['加我微信领优惠'] });
  });

  it('does not advance the ladder for a message sent before the last notice', async () => {
    const { store, hit, advance, mute } = harness();
    await activate(store);
    const sentBefore = 999_000;
    await hit();
    advance(1_000);
    await expect(hit({ sentAt: sentBefore })).resolves.toMatchObject({ kind: 'skipped', reasonCode: 'before_last_notice' });
    expect(mute).not.toHaveBeenCalled();
  });

  it('resets the ladder after the quiet window and repeats the last stage when exhausted', async () => {
    const { store, hit, advance, mute } = harness();
    await activate(store);
    await hit();
    advance(31 * 60_000);
    await expect(hit()).resolves.toMatchObject({ action: 'remind', stage: 1 });
    advance(1_000);
    await expect(hit()).resolves.toMatchObject({ action: 'mute', stage: 2 });
    advance(61_000);
    await expect(hit()).resolves.toMatchObject({ action: 'mute', stage: 2 });
    expect(mute).toHaveBeenCalledTimes(2);
  });

  it('skips owners / admins and whitelisted members', async () => {
    const { store, hit, send, codes } = harness();
    await activate(store, { ...remindThenMute, exempt: { ownerAndAdmins: true, userIds: ['vip'] } });
    await expect(hit({ memberRoles: ['admin'] })).resolves.toMatchObject({ kind: 'skipped', reasonCode: 'rule_hit_exempt' });
    await expect(hit({ memberId: 'vip' })).resolves.toMatchObject({ kind: 'skipped', reasonCode: 'rule_hit_exempt' });
    expect(send).not.toHaveBeenCalled();
    expect(await codes()).toEqual(expect.arrayContaining(['rule_enforcement:skip:rule_hit_exempt']));
  });

  it('takes no action during emergency_stop / read_only and records why (acceptance 6)', async () => {
    const control = new AiControlPlane();
    await control.set({ expectedRevision: 0, actorId: 'op', sessions: [{ platform: 'icqq', sceneId: 'group:123', flags: { emergency_stop: true } }] });
    const { store, hit, send, mute, codes } = harness({ control });
    await activate(store, { ...remindThenMute, ladder: [{ action: 'mute', durationSec: 600 }] });
    await expect(hit()).resolves.toMatchObject({ kind: 'skipped', reasonCode: 'control_emergency_stop' });
    expect(mute).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    // A remind stage is blocked at the speaking gate too.
    await activate(store, { ...remindThenMute, trigger: 'abuse' });
    await expect(hit({ trigger: 'abuse' })).resolves.toMatchObject({ kind: 'skipped', reasonCode: 'control_emergency_stop' });
    expect(send).not.toHaveBeenCalled();
    expect(await codes()).toEqual(expect.arrayContaining([
      'tool_hard_gate:deny:control_emergency_stop',
      'rule_enforcement:deny:control_emergency_stop',
    ]));
  });

  it('skips when the bot cannot moderate, and tells the group once a day', async () => {
    const { store, hit, advance, send, mute, codes } = harness({ canModerate: false });
    await activate(store, { ...remindThenMute, ladder: [{ action: 'mute', durationSec: 600 }] });
    await expect(hit()).resolves.toMatchObject({ kind: 'skipped', reasonCode: 'rule_hit_bot_not_admin' });
    advance(1_000);
    await hit({ memberId: 'u-2' });
    expect(mute).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [unknown, Array<{ text?: string }>])[1][0]!.text).toContain('不是管理员');
    expect(await codes()).toEqual(expect.arrayContaining(['rule_enforcement:skip:rule_hit_bot_not_admin']));
  });

  it('suggest_kick raises one fresh human card, kicks only after approval, dedups via ops_cooldown (acceptance 4)', async () => {
    const { store, queue, hit, advance, kick, enforcer, codes } = harness();
    await activate(store, { ...remindThenMute, ladder: [{ action: 'suggest_kick' }] });

    await expect(hit()).resolves.toMatchObject({ kind: 'enforced', action: 'suggest_kick' });
    const cards = queue.list({ status: 'pending' });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ toolName: GROUP_RULE_KICK_TOOL_NAME, category: 'member' });
    expect(cards[0]!.origin).toMatchObject({ platform: 'icqq', endpointKey: '10086', scope: 'group', sceneId: '123' });
    expect(kick).not.toHaveBeenCalled();

    advance(10_000);
    await expect(hit()).resolves.toMatchObject({ kind: 'skipped', reasonCode: 'ops_cooldown_hit' });
    expect(queue.list({ status: 'pending' })).toHaveLength(1);

    queue.resolve(cards[0]!.id, true, 'admin-2', { channel: 'im_approver_group' });
    await enforcer.drain();
    expect(kick).toHaveBeenCalledTimes(1);
    expect(await codes()).toEqual(expect.arrayContaining([
      'rule_enforcement:defer:rule_hit_kick_suggested',
      'tool_approval:defer:tool_approval_requested',
      'tool_hard_gate:allow:tool_approval_approved',
      'outbound:allow:outbound_sent',
    ]));
  });

  it('does not kick when the card is denied', async () => {
    const { store, queue, hit, kick, enforcer } = harness();
    await activate(store, { ...remindThenMute, ladder: [{ action: 'suggest_kick' }] });
    await hit();
    const [card] = queue.list({ status: 'pending' });
    queue.resolve(card!.id, false, 'admin-2');
    await enforcer.drain();
    expect(kick).not.toHaveBeenCalled();
  });

  it('refuses a rule whose fields no longer match its approved hash', async () => {
    const { store, hit, mute, send, codes } = harness();
    const rule = await activate(store, { ...remindThenMute, ladder: [{ action: 'mute', durationSec: 600 }] });
    vi.spyOn(store, 'getActive').mockResolvedValueOnce({ ...rule, ladder: [{ action: 'mute', durationSec: 86_400 }] });
    await expect(hit()).resolves.toMatchObject({ kind: 'skipped', reasonCode: 'rule_hash_mismatch' });
    expect(mute).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect((await codes()).filter((code) => !code.startsWith('group_rule:'))).toEqual(['rule_enforcement:deny:rule_hash_mismatch']);
  });

  it('a failed platform mute does not advance the ladder', async () => {
    const { store, hit, advance, mute } = harness({ mute: async () => { throw new Error('platform_refused'); } });
    await activate(store, { ...remindThenMute, ladder: [{ action: 'mute', durationSec: 600 }, { action: 'suggest_kick' }] });
    await expect(hit()).resolves.toMatchObject({ kind: 'failed', action: 'mute', reason: 'platform_refused' });
    advance(61_000);
    await expect(hit()).resolves.toMatchObject({ action: 'mute', stage: 1 });
    expect(mute).toHaveBeenCalledTimes(2);
  });

  it('serializes concurrent hits for the same member so one message cannot skip a stage', async () => {
    const { store, hit, mute, send } = harness();
    await activate(store);
    const results = await Promise.all([hit({ messageId: 'a' }), hit({ messageId: 'b' })]);
    expect(results[0]).toMatchObject({ action: 'remind' });
    // Same sentAt as the first: it was sent before the reminder was delivered.
    expect(results[1]).toMatchObject({ kind: 'skipped', reasonCode: 'before_last_notice' });
    expect(mute).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps ladder progress bounded in memory and clears it on dispose', async () => {
    const { store, hit, advance, enforcer } = harness();
    await activate(store);
    for (let index = 0; index < 5; index += 1) {
      await hit({ memberId: `u-${index}` });
      advance(10);
    }
    expect(enforcer.progressSize).toBe(5);
    enforcer.dispose();
    expect(enforcer.progressSize).toBe(0);
    await expect(hit()).resolves.toEqual({ kind: 'no_rule' });
  });
});
