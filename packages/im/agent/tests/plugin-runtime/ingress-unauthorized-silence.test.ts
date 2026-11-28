import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { inboundOutcomeSink } from '@zhin.js/core/runtime';
import { tryHandleIngressCommands, type IngressCommandsContext } from '../../src/plugin-runtime/ingress/ingress-management-stage.js';
import { OwnerApprovalRuntime } from '../../src/security/owner-approval-runtime.js';
import { adapterFeatureId } from '@zhin.js/adapter';
import { describeGlobalOwnerRequired } from '@zhin.js/permission';

/**
 * zhinjs/zhin#1250: approval-card, owner `/approve` and group-rule commands from a sender
 * without the permission are silent in a group or channel and explained in a private chat. Either way
 * the message is handled here (returns true: the spine stops before any AI turn, so no model answers
 * "you are not allowed" in the bot's place) and its outcome is `permission_denied`. The Agent
 * management commands (`models`, `tree`, `reset` …) are Root commands since 第 83 批 (see
 * tests/init/runtime-management-commands.test.ts) and no longer reach this stage.
 */
describe('Agent ingress refusals of unauthorized senders (#1250)', () => {
  let tmp: string;
  let ownerApprovals: OwnerApprovalRuntime;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-unauthorized-'));
    ownerApprovals = new OwnerApprovalRuntime(tmp);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function run(options: {
    content: string;
    kind?: 'group' | 'private' | 'channel';
    globalOwner?: boolean;
    groupRuleReply?: (input: { onUnauthorized?: (reason: string) => void }) => string | null;
    toolApprovalReply?: (input: { onUnauthorized?: (reason: string) => void }) => string | null;
  }) {
    const kind = options.kind ?? 'group';
    const outcomes: Record<string, unknown>[] = [];
    const sink = { report: (candidate: Record<string, unknown>) => { outcomes.push(candidate); return true; }, enter() {} };
    const message = {
      conversation: { endpoint: { adapter: 'qq', id: 'bot-1' }, kind, id: kind === 'private' ? 'u1' : '100' },
      content: options.content,
      commandPrefix: '/',
      locale: 'zh-CN',
      sender: { id: 'u1', ...(options.globalOwner ? { chatRole: 'owner', chatRoleLevels: { owner: 'global' } } : {}) },
      [inboundOutcomeSink]: () => sink,
    };
    const reply = vi.fn(async () => ({ status: 'sent' }));
    const archiveSession = vi.fn(async () => true);
    const input = {
      message,
      turnAccess: { origin: { kind: 'im', platform: 'qq', scope: kind, sceneId: '100' }, principal: { subjectId: 'u1' } },
      ownerId: 'owner-1',
      effectiveEndpoint: 'bot-1',
      agent: { service: {}, agent: { archiveSession, ownerApprovals }, semanticMemory: null },
      groupRules: { handleCommand: async (command: { onUnauthorized?: (reason: string) => void }) => options.groupRuleReply?.(command) ?? null },
      toolApprovalIm: { handleCommand: (command: { onUnauthorized?: (reason: string) => void }) => options.toolApprovalReply?.(command) ?? null },
      reply,
    } as unknown as IngressCommandsContext;
    return { input, reply, archiveSession, outcomes };
  }

  it('leaves the management commands to the command dispatch (#1250 第 83 批)', async () => {
    for (const content of ['/models', '/tree', '/fork 1', '/compact', '/reset', '/health', 'ai.health']) {
      const t = run({ content });
      expect(await tryHandleIngressCommands(t.input)).toBe(false);
      expect(t.reply).not.toHaveBeenCalled();
      expect(t.archiveSession).not.toHaveBeenCalled();
      expect(t.outcomes).toEqual([]);
    }
  });

  it('is silent to a group-rule or approval-card refusal flagged unauthorized, and replies otherwise', async () => {
    const rule = run({ content: '/rule approve abc', groupRuleReply: command => { command.onUnauthorized?.('not_rule_approver'); return '只有本群群主或管理员可以审批'; } });
    expect(await tryHandleIngressCommands(rule.input)).toBe(true);
    expect(rule.reply).not.toHaveBeenCalled();
    expect(rule.outcomes).toEqual([expect.objectContaining({ outcome: 'permission_denied', reason: 'not_rule_approver', reply: 'no' })]);
    const card = run({ content: '/approve tap_1', toolApprovalReply: command => { command.onUnauthorized?.('not_approver'); return '你不在审批人名单'; } });
    expect(await tryHandleIngressCommands(card.input)).toBe(true);
    expect(card.reply).not.toHaveBeenCalled();
    expect(card.outcomes).toEqual([expect.objectContaining({ outcome: 'permission_denied', reason: 'not_approver', reply: 'no' })]);
    const cardDm = run({ content: '/approve tap_1', kind: 'private', toolApprovalReply: command => { command.onUnauthorized?.('not_approver'); return '你不在审批人名单'; } });
    expect(await tryHandleIngressCommands(cardDm.input)).toBe(true);
    expect(cardDm.reply).toHaveBeenCalledWith('你不在审批人名单');
    const approverMistake = run({ content: '/approve tap_1', toolApprovalReply: () => '请在私聊中审批' });
    expect(await tryHandleIngressCommands(approverMistake.input)).toBe(true);
    expect(approverMistake.reply).toHaveBeenCalledWith('请在私聊中审批');
    expect(approverMistake.outcomes).toEqual([]);
  });

  it('is silent to a non-owner sending /approve in a group; a global owner there is told to use a private chat', async () => {
    const member = run({ content: '/approve always bash' });
    expect(await tryHandleIngressCommands(member.input)).toBe(true);
    expect(member.reply).not.toHaveBeenCalled();
    expect(member.outcomes).toEqual([expect.objectContaining({ outcome: 'permission_denied', reason: 'not_global_owner', reply: 'no' })]);
    const memberDm = run({ content: '/approve always bash', kind: 'private' });
    expect(await tryHandleIngressCommands(memberDm.input)).toBe(true);
    expect(memberDm.reply).toHaveBeenCalledWith(expect.stringContaining('仅全局聊天主人'));
    const owner = run({ content: '/approve always bash', globalOwner: true });
    expect(await tryHandleIngressCommands(owner.input)).toBe(true);
    expect(owner.reply).toHaveBeenCalledWith(expect.stringContaining('私聊'));
    expect(owner.outcomes).toEqual([]);
  });

  it('tells a non-owner of a Sandbox-only project to use the Sandbox identity (#1250 b116)', async () => {
    const memberDm = run({ content: '/approve always bash', kind: 'private' });
    const simulation = { default: { delivery: { send: true }, runtime: { sandbox: true } } };
    const adapters = { $projection: 'zhin.adapter-index/1', describe: () => [{ id: 'sandbox' }], capabilityProfile: () => simulation };
    const input = { ...memberDm.input, snapshot: { projections: new Map([[adapterFeatureId, adapters]]) } } as unknown as IngressCommandsContext;
    expect(await tryHandleIngressCommands(input)).toBe(true);
    expect(memberDm.reply).toHaveBeenCalledWith(describeGlobalOwnerRequired('zh-CN', { privateChat: true, simulationOnly: true }));
  });

  it('passes ordinary messages on (no refusal, no outcome)', async () => {
    const t = run({ content: 'hello' });
    expect(await tryHandleIngressCommands(t.input)).toBe(false);
    expect(t.outcomes).toEqual([]);
  });
});
