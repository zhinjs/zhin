import { describe, expect, it, vi } from 'vitest';
import { AiControlPlane, AiGroupRules, DecisionEventLog, groupRuleHashShort } from '@zhin.js/agent';
import { resolveToolHardGateImApproval } from '@zhin.js/agent/security';
import { GroupRuleImChannel, formatGroupRuleCard, type GroupRuleCommandInput } from '../../../../src/plugin-runtime/agent/turn/group-rule-im.js';

const scene = { platform: 'icqq', sceneId: 'group:123' };
const spec = { trigger: 'advertising', ladder: [{ action: 'remind' }, { action: 'mute', durationSec: 600 }], content: '发广告先提醒再禁言' };

function harness(options: { approvers?: string[]; control?: AiControlPlane } = {}) {
  const log = new DecisionEventLog();
  const store = new AiGroupRules({ audit: () => log });
  const send = vi.fn(async () => undefined);
  const channel = new GroupRuleImChannel({
    rules: () => store,
    controlPlane: () => options.control,
    imApproval: () => resolveToolHardGateImApproval(options.approvers ? { approverIds: options.approvers } : undefined),
    send,
  });
  const stop = channel.start();
  const command = (text: string, overrides: Partial<GroupRuleCommandInput> = {}) => channel.handleCommand({
    platform: 'icqq', scope: 'group', sceneId: '123', senderId: 'u-1', senderRoles: ['admin'], endpoint: '10086', commandText: text, ...overrides,
  });
  const submitted = async () => {
    const created = await store.create({ ...scene, ...spec, createdBy: 'u-9', createdVia: 'model' });
    const pending = await store.submit({ id: created.record.id, expectedRevision: created.record.revision, actorId: 'u-9', endpoint: '10086' });
    await channel.drain();
    return pending.record;
  };
  const codes = async () => {
    await log.idle();
    return log.recent().map((row) => row.reasonCode);
  };
  return { store, send, channel, stop, command, submitted, codes };
}

describe('group rule IM channel', () => {
  it('posts a preview card to the rule\'s group when a rule is submitted', async () => {
    const { send, submitted } = harness();
    const rule = await submitted();
    expect(send).toHaveBeenCalledTimes(1);
    const [target, text] = send.mock.calls[0] as unknown as [unknown, string];
    expect(target).toEqual({ platform: 'icqq', endpoint: '10086', groupId: '123' });
    expect(text).toContain(`摘要 ${groupRuleHashShort(rule.contentHash)}`);
    expect(text).toContain('第 2 次：禁言 10 分钟');
    expect(text).toContain(`/rule approve ${groupRuleHashShort(rule.contentHash)}`);
  });

  it('lets an admin approve with the card code; audit drafted → submitted → approved', async () => {
    const { store, command, submitted, codes } = harness();
    const rule = await submitted();
    const reply = await command(`rule approve ${groupRuleHashShort(rule.contentHash)}`);
    expect(reply).toContain('已生效');
    expect(await store.getActive({ ...scene, trigger: 'advertising' })).toMatchObject({ id: rule.id, approvedBy: 'u-1', approvedVia: 'im' });
    expect(await codes()).toEqual(['rule_drafted', 'rule_submitted', 'rule_approved']);
  });

  it('refuses ordinary members but accepts configured IM approvers', async () => {
    const { store, command, submitted } = harness({ approvers: ['u-7'] });
    const rule = await submitted();
    const code = groupRuleHashShort(rule.contentHash);
    expect(await command(`rule approve ${code}`, { senderId: 'u-2', senderRoles: ['user'] })).toContain('只有本群群主或管理员');
    expect((await store.get(rule.id))!.status).toBe('pending');
    expect(await command(`rule approve ${code}`, { senderId: 'u-7', senderRoles: ['user'] })).toContain('已生效');
  });

  it('only settles in the rule\'s own group and with a matching code', async () => {
    const { store, command, submitted } = harness();
    const rule = await submitted();
    const code = groupRuleHashShort(rule.contentHash);
    expect(await command(`rule approve ${code}`, { sceneId: '999' })).toContain('没有摘要为');
    expect(await command(`rule approve ${code}`, { scope: 'private' })).toContain('只能在对应的群');
    expect(await command('rule approve deadbeef')).toContain('没有摘要为');
    expect((await store.get(rule.id))!.status).toBe('pending');
  });

  it('a rule edited after the card cannot be approved with the old code', async () => {
    const { store, command, submitted } = harness();
    const rule = await submitted();
    const oldCode = groupRuleHashShort(rule.contentHash);
    await store.edit({ id: rule.id, expectedRevision: rule.revision, actorId: 'console', spec: { ...spec, ladder: [{ action: 'mute', durationSec: 3600 }] } });
    expect(await command(`rule approve ${oldCode}`)).toContain('没有摘要为');
  });

  it('rejects, lists and disables', async () => {
    const { store, command, submitted } = harness();
    const first = await submitted();
    expect(await command(`rule reject ${groupRuleHashShort(first.contentHash)}`)).toContain('已驳回');
    expect((await store.get(first.id))!.status).toBe('rejected');
    const second = await submitted();
    await command(`rule approve ${groupRuleHashShort(second.contentHash)}`);
    expect(await command('rules', { senderRoles: ['user'] })).toContain('生效中');
    expect(await command('rule disable advertising', { senderRoles: ['user'] })).toContain('只有本群群主或管理员');
    expect(await command('rule disable advertising', { senderRoles: ['owner'] })).toContain('已停用');
    expect(await store.getActive({ ...scene, trigger: 'advertising' })).toBeNull();
    expect(await command('rules')).toContain('还没有');
  });

  it('ignores unrelated commands', async () => {
    const { command } = harness();
    expect(await command('approve tap_x')).toBeNull();
    expect(await command(undefined as unknown as string)).toBeNull();
  });

  it('announces Console approvals in the group but not IM approvals (the command reply covers those)', async () => {
    const { store, send, channel, command, submitted } = harness();
    const first = await submitted();
    await command(`rule approve ${groupRuleHashShort(first.contentHash)}`);
    await channel.drain();
    expect(send).toHaveBeenCalledTimes(1);
    const second = await submitted();
    await store.approve({ id: second.id, expectedRevision: second.revision, actorId: 'console', approvedVia: 'console' });
    await channel.drain();
    expect(send).toHaveBeenCalledTimes(3);
    expect((send.mock.calls[2] as unknown as [unknown, string])[1]).toContain('群规已生效');
  });

  it('does not post cards while the control plane blocks the group', async () => {
    const control = new AiControlPlane();
    await control.set({ expectedRevision: 0, sessions: [{ platform: 'icqq', sceneId: 'group:123', flags: { read_only: true } }], actorId: 'op' });
    const { send, submitted } = harness({ control });
    await submitted();
    expect(send).not.toHaveBeenCalled();
  });

  it('stops posting after stop()', async () => {
    const { send, stop, submitted } = harness();
    stop();
    await submitted();
    expect(send).not.toHaveBeenCalled();
  });

  it('card lists suggest_kick as human-approved and extra exemptions', () => {
    const text = formatGroupRuleCard({
      id: 'r', platform: 'icqq', sceneId: 'group:1', trigger: 'flood', ladder: [{ action: 'suggest_kick' }], windowMs: 3_600_000,
      exempt: { ownerAndAdmins: true, userIds: ['a', 'b'] }, content: '', contentHash: 'abcdef1234', status: 'pending',
      createdBy: 'u', createdVia: 'console', approvedBy: null, approvedAt: null, approvedVia: null, submittedAt: 1,
      revision: 2, reason: null, createdAt: 1, updatedAt: 1, updatedBy: 'u',
    }, 86_400_000);
    expect(text).toContain('刷屏复读');
    expect(text).toContain('人批才踢');
    expect(text).toContain('另加 2 人');
    expect(text).toContain('1 小时内无再犯');
    expect(text).toContain('24 小时内未批');
  });
});
