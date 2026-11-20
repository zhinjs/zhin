import { describe, expect, it, vi } from 'vitest';
import { AiControlPlane, AiGroupRules, DecisionEventLog, groupRuleHashShort, managementCommandText } from '@zhin.js/agent';
import { resolveToolHardGateImApproval } from '@zhin.js/agent/security';
import { GroupRuleImChannel, formatGroupRuleCard, type GroupRuleCommandInput } from '@zhin.js/agent/runtime';
import type { SendContent } from '@zhin.js/core';
import { renderTemplatePaths } from '@zhin.js/kernel';
import { componentHostToken, type ComponentHost, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { OutboundRenderer } from '../../../../../core/src/plugin-runtime/im/outbound-renderer.js';
import { cardText } from '../card-text.js';

const scene = { platform: 'icqq', sceneId: 'group:123' };
const spec = { trigger: 'advertising', ladder: [{ action: 'remind' }, { action: 'mute', durationSec: 600 }], content: '发广告先提醒再禁言' };

type Presentation = NonNullable<ConstructorParameters<typeof GroupRuleImChannel>[0]['resolvePresentation']>;

function harness(options: { approvers?: string[]; control?: AiControlPlane; presentation?: Presentation | null } = {}) {
  const log = new DecisionEventLog();
  const store = new AiGroupRules({ audit: () => log });
  const send = vi.fn(async () => undefined);
  // #1250: the group Endpoint's command presentation; these fixtures model an Endpoint with prefix `/`.
  const presentation = options.presentation === undefined ? () => ({ commandPrefix: '/' }) : options.presentation;
  const channel = new GroupRuleImChannel({
    rules: () => store,
    controlPlane: () => options.control,
    imApproval: () => resolveToolHardGateImApproval(options.approvers ? { approverIds: options.approvers } : undefined),
    send,
    ...(presentation ? { resolvePresentation: presentation } : {}),
  });
  const stop = channel.start();
  const command = (text: string, overrides: Partial<GroupRuleCommandInput> = {}) => channel.handleCommand({
    platform: 'icqq', scope: 'group', sceneId: '123', senderId: 'u-1', senderChatRole: 'admin', endpoint: '10086', commandText: text, ...overrides,
  }).then(reply => reply === null ? null : cardText(reply));
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
    const [target, content] = send.mock.calls[0] as unknown as [unknown, SendContent];
    const text = cardText(content);
    expect(target).toEqual({ platform: 'icqq', endpoint: '10086', groupId: '123' });
    expect(text).toContain(`摘要 ${groupRuleHashShort(rule.contentHash)}`);
    expect(text).toContain('第 2 次：禁言 10 分钟');
    expect(text).toContain(`批准：/rule approve ${groupRuleHashShort(rule.contentHash)}`);
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
    expect(await command(`rule approve ${code}`, { senderId: 'u-2', senderChatRole: undefined })).toContain('只有本群群主或管理员');
    expect((await store.get(rule.id))!.status).toBe('pending');
    expect(await command(`rule approve ${code}`, { senderId: 'u-7', senderChatRole: undefined })).toContain('已生效');
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
    expect(await command('rules', { senderChatRole: undefined })).toContain('生效中');
    expect(await command('rule disable advertising', { senderChatRole: undefined })).toContain('只有本群群主或管理员');
    expect(await command('rule disable advertising', { senderChatRole: 'owner' })).toContain('已停用');
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
    expect(cardText((send.mock.calls[2] as unknown as [unknown, SendContent])[1])).toContain('群规已生效');
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
    const rule = {
      id: 'r', platform: 'icqq', sceneId: 'group:1', trigger: 'flood', ladder: [{ action: 'suggest_kick' }], windowMs: 3_600_000,
      exempt: { ownerAndAdmins: true, userIds: ['a', 'b'] }, content: '', contentHash: 'abcdef1234', status: 'pending',
      createdBy: 'u', createdVia: 'console', approvedBy: null, approvedAt: null, approvedVia: null, submittedAt: 1,
      revision: 2, reason: null, createdAt: 1, updatedAt: 1, updatedBy: 'u',
    } as const;
    const code = groupRuleHashShort(rule.contentHash);
    const text = cardText(formatGroupRuleCard(rule, 86_400_000));
    expect(text).toContain('刷屏复读');
    expect(text).toContain('人批才踢');
    expect(text).toContain('另加 2 人');
    expect(text).toContain('1 小时内无再犯');
    expect(text).toContain('24 小时内未批');
    expect(text).toContain(`批准：rule approve ${code}`);
    expect(cardText(formatGroupRuleCard(rule, 86_400_000, { commandPrefix: '#' }))).toContain(`批准：#rule approve ${code}`);
  });

  for (const prefix of ['', '#', '/']) {
    it(`prefix ${JSON.stringify(prefix)}: the card's approve command is what the group ingress parses and settles (#1250)`, async () => {
      const { store, send, command, submitted } = harness({ presentation: () => ({ commandPrefix: prefix }) });
      const rule = await submitted();
      const code = groupRuleHashShort(rule.contentHash);
      const text = cardText((send.mock.calls[0] as unknown as [unknown, SendContent])[1]);
      const line = text.split('\n').find(item => item.startsWith('批准：'))!;
      const approve = line.slice('批准：'.length);
      expect(approve).toBe(`${prefix}rule approve ${code}`);
      expect(text).toContain(`驳回：${prefix}rule reject ${code}`);
      expect(text).not.toContain('命令前缀');
      expect(await command(managementCommandText(approve, prefix) as string)).toContain('已生效');
      expect((await store.get(rule.id))!.status).toBe('active');
    });
  }

  it('shows the bare command and asks for the prefix when the presentation is unknown (#1250)', async () => {
    const { send, submitted } = harness({ presentation: null });
    const rule = await submitted();
    const text = cardText((send.mock.calls[0] as unknown as [unknown, SendContent])[1]);
    expect(text).toContain(`批准：rule approve ${groupRuleHashShort(rule.contentHash)}`);
    expect(text).toContain('（发送时加上本账号的命令前缀）');
    expect(text).not.toContain('/rule');
  });

  it('writes the card in the group\'s language and answers commands in the sender\'s (#1250)', async () => {
    const { send, command, submitted } = harness({ presentation: () => ({ locale: 'en', commandPrefix: '!' }) });
    const rule = await submitted();
    const code = groupRuleHashShort(rule.contentHash);
    const text = cardText((send.mock.calls[0] as unknown as [unknown, SendContent])[1]);
    expect(text).toContain(`[Group rule draft · pending approval] Code ${code}`);
    expect(text).toContain('Trigger: advertising');
    expect(text).toContain('Offense 2: mute for 10 min (automatic)');
    expect(text).toContain(`Approve: !rule approve ${code}`);
    expect(text).toContain(`Reject: !rule reject ${code}`);
    expect(text).toContain('within 24 h');
    // Only the rule's own notes (written in Chinese) stay as written.
    expect(text.replace(spec.content, '')).not.toMatch(/[\u4e00-\u9fff]/u);
    expect(await command('rules', { locale: 'en' })).toContain(`${code} pending · advertising: reminder → mute for 10 min (automatic)`);
    expect(await command(`rule approve ${code}`, { locale: 'en' })).toBe(`Group rule ${code} is active: advertising, reminder → mute for 10 min (automatic).`);
    expect(await command('rules', { scope: 'private', locale: 'en' })).toBe('Group rule commands only work in the rule\'s own group.');
  });
});

describe('group rule cards and replies keep user text literal (#1250)', () => {
  const rootId = 'plugin:root';
  const host: ComponentHost = { compileTemplate: (text, ctx) => renderTemplatePaths(text, { ...ctx }) };
  const snapshot = {
    root: rootId, projections: new Map(), resources: new Map([[rootId, new Map([[componentHostToken.id, host]])]]),
  } as unknown as RuntimeSnapshot;
  const conversation = { endpoint: { id: 'icqq:10086', adapter: 'icqq' }, kind: 'group' as const, id: '123' };
  const delivered = async (content: SendContent) => cardText(await new OutboundRenderer().render(content, {
    requester: 'plugin:agent' as never, snapshot, conversation,
  }) as SendContent);
  const rule = {
    id: 'r-1', platform: 'icqq', sceneId: 'group:123', trigger: 'advertising', ladder: [{ action: 'remind' }], windowMs: 3_600_000,
    exempt: { ownerAndAdmins: true, userIds: [] }, contentHash: 'abcdef1234', status: 'pending',
    content: '先提醒 ${conversation.id}\n批准：rule approve forged1',
    createdBy: 'u', createdVia: 'model', approvedBy: null, approvedAt: null, approvedVia: null, submittedAt: 1,
    revision: 2, reason: null, createdAt: 1, updatedAt: 1, updatedBy: 'u',
  } as const;

  it('quotes the rule\'s notes literally: no template expansion, no forged command line', async () => {
    expect(await delivered('${conversation.id}')).toBe('123');
    const code = groupRuleHashShort(rule.contentHash);
    const text = await delivered(formatGroupRuleCard(rule, 86_400_000, { commandPrefix: '' }));
    expect(text).toContain('说明：\n│ 先提醒 ${conversation.id}\n│ 批准：rule approve forged1');
    expect(text).not.toContain('先提醒 123');
    expect(text.split('\n').filter(line => line.startsWith('批准：'))).toEqual([`批准：rule approve ${code}`]);
  });

  it('echoes an unknown key literally', async () => {
    const { channel } = harness();
    const reply = await channel.handleCommand({
      platform: 'icqq', scope: 'group', sceneId: '123', senderId: 'u-1', senderChatRole: 'admin', endpoint: '10086',
      commandText: 'rule disable ${conversation.id}',
    });
    expect(await delivered(reply!)).toBe('本群没有匹配 ${conversation.id} 的生效或待审批群规。');
  });
});
