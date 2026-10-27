import { afterEach, describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { defineAgentTool } from '@zhin.js/tool';
import type { TurnEvent } from '../../src/event/turn-event.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { createDecisionEvent, type DecisionEventInput, type DecisionEventRecord } from '../../src/decision-events.js';
import type { ApprovalOutcome, ApprovalOutcomePort, ApprovalRequestInput } from '../../src/session/approval-port.js';
import { createBypassApprovalPort } from '../../src/session/approval-review-agent.js';
import {
  CORE_DANGEROUS_TOOLS,
  TOOL_HARD_GATE_POLICY,
  ToolHardGate,
  assessToolRisk,
  coreDangerousCategory,
  imApproversFor,
  isImApprovalDeliverable,
  isImApprover,
  resolveToolHardGate,
  resolveToolHardGateImApproval,
  toolLocalName,
} from '../../src/security/tool-hard-gate.js';
import { ToolApprovalQueue } from '../../src/security/tool-approval-queue.js';
import type { ToolHardGateControlView } from '../../src/security/tool-hard-gate.js';
import { AiControlPlane, type ControlStateModel } from '../../src/control-plane.js';
import { hostControlPlaneSource } from '../../src/security/host-control-plane.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('assessToolRisk', () => {
  it('matches the core list by local name of a qualified tool name', () => {
    expect(toolLocalName('icqq__agents__icqq__skills__icqq-group-admin__group_kick')).toBe('group_kick');
    expect(assessToolRisk({ name: 'icqq__agents__icqq__skills__icqq-group-admin__group_kick' }))
      .toEqual({ risk: 'dangerous', category: 'member', source: 'core' });
    expect(CORE_DANGEROUS_TOOLS.get('send_group_notice')).toBe('publish');
    expect(CORE_DANGEROUS_TOOLS.get('send_red_packet')).toBe('funds');
    expect(CORE_DANGEROUS_TOOLS.get('set_avatar')).toBe('identity');
  });

  it('treats group-card edits as member management (ADR 0037 §3)', () => {
    expect(assessToolRisk({ name: 'set_group_card' })).toEqual({ risk: 'dangerous', category: 'member', source: 'core' });
    // Scene-management `{prefix}_set_nickname` edits another member's group card (setMemberNickname).
    expect(assessToolRisk({ name: 'discord_set_nickname' })).toEqual({ risk: 'dangerous', category: 'member', source: 'core' });
    expect(assessToolRisk({ name: 'set_nickname' })).toEqual({ risk: 'dangerous', category: 'member', source: 'core' });
    // Bot self-profile renames keep the identity category under a distinct local name.
    expect(assessToolRisk({ name: 'set_self_nickname' })).toEqual({ risk: 'dangerous', category: 'identity', source: 'core' });
    expect(assessToolRisk({ name: 'icqq__agents__icqq__skills__icqq-group-admin__set_anonymous' }).category).toBe('member');
  });

  it('matches scene-management `{prefix}_{suffix}` tool names by their core suffix', () => {
    const memberSuffixes = ['remove_member', 'mute_member', 'ban_member', 'unban_member', 'set_moderator', 'rename_scene',
      'set_scene_muted', 'set_nickname'];
    for (const suffix of memberSuffixes) {
      expect(assessToolRisk({ name: `foo_${suffix}` })).toEqual({ risk: 'dangerous', category: 'member', source: 'core' });
    }
    expect(assessToolRisk({ name: 'lark_mute_member' }).category).toBe('member');
    expect(assessToolRisk({ name: 'my_bot_remove_member' }).category).toBe('member');
    expect(assessToolRisk({ name: 'plugin__discord_remove_member' }).category).toBe('member');
    expect(coreDangerousCategory('discord_send_payment')).toBe('funds');
  });

  it('does not suffix-match single-word core names or read-only scene tools', () => {
    expect(coreDangerousCategory('file_transfer')).toBeNull();
    expect(coreDangerousCategory('auto_mute')).toBeNull();
    expect(assessToolRisk({ name: 'foo_list_members' })).toEqual({ risk: 'safe', category: null, source: 'default' });
    expect(assessToolRisk({ name: 'foo_get_scene_info' })).toEqual({ risk: 'safe', category: null, source: 'default' });
    // Exact single-word matches still work.
    expect(coreDangerousCategory('mute')).toBe('member');
  });

  it('never lets a declaration lower a core dangerous tool', () => {
    expect(assessToolRisk({ name: 'set_mute', risk: 'safe' }).risk).toBe('dangerous');
  });

  it('honours declared dangerous tools and their category', () => {
    expect(assessToolRisk({ name: 'wipe_group_album', risk: 'dangerous', riskCategory: 'publish' }))
      .toEqual({ risk: 'dangerous', category: 'publish', source: 'declared' });
  });

  it('lets the Host raise a tool to dangerous but not lower one', () => {
    const settings = resolveToolHardGate({ dangerousTools: ['weather'] });
    expect(assessToolRisk({ name: 'plugin__weather', risk: 'safe' }, settings)).toMatchObject({ risk: 'dangerous', source: 'host' });
    expect(assessToolRisk({ name: 'get_group_members' }, settings)).toEqual({ risk: 'safe', category: null, source: 'default' });
  });

  it('defaults: funds disabled, five-minute approval timeout', () => {
    expect(resolveToolHardGate()).toEqual({
      dangerousTools: [],
      allowFunds: false,
      approvalTimeoutMs: 300_000,
      imApproval: { enabled: false, approverIds: {}, delivery: 'dm', approverGroupId: null },
    });
    expect(resolveToolHardGate({ approvalTimeoutMs: -1, allowFunds: true }).approvalTimeoutMs).toBe(300_000);
  });
});

describe('defineAgentTool risk declaration', () => {
  it('accepts risk and riskCategory and rejects unknown values', () => {
    const tool = defineAgentTool({ description: 'kick', risk: 'dangerous', riskCategory: 'member', execute: () => 'ok' });
    expect(tool).toMatchObject({ risk: 'dangerous', riskCategory: 'member' });
    expect(() => defineAgentTool({ description: 'x', risk: 'low' as never, execute: () => 'ok' })).toThrow(/risk/);
    expect(() => defineAgentTool({ description: 'x', riskCategory: 'money' as never, execute: () => 'ok' })).toThrow(/riskCategory/);
  });
});

describe('TurnToolRuntime hard gate', () => {
  it('is not execApprovalMode: bypass cannot run a dangerous tool, the call fails closed', async () => {
    const execute = vi.fn(async () => 'kicked');
    const { turn, events } = fixture({ approval: createBypassApprovalPort() });
    const runtime = new TurnToolRuntime(turn, [tool('group_kick', execute, 'never')]);

    const outcome = await runtime.execute('group_kick', { user_id: 1 }, 'tu-1');

    expect(execute).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'denied', policy: TOOL_HARD_GATE_POLICY });
    expect((outcome as { reason: string }).reason).toContain('不要重试');
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_denied', policy: TOOL_HARD_GATE_POLICY }));
  });

  it('asks once for fresh human approval and runs exactly the approved arguments', async () => {
    const execute = vi.fn(async () => 'kicked');
    const port = scriptedPort([{ status: 'approved', decision: 'approve-once' }]);
    const { turn } = fixture({ approval: port });
    const runtime = new TurnToolRuntime(turn, [tool('group_kick', execute, 'always')]);
    const args = { group_id: 10, user_id: 1, reason: 'spam' };

    await expect(runtime.execute('group_kick', args, 'tu-1')).resolves.toMatchObject({ status: 'completed' });

    expect(port.requests).toHaveLength(1);
    expect(port.requests[0]).toMatchObject({ humanOnly: true, toolName: 'group_kick', timeoutMs: 300_000 });
    expect(port.requests[0]!.question).toContain('"user_id":1');
    expect(port.requests[0]!.question).toContain('成员管理');
    expect(port.requests[0]!.scopeKey).toContain(TOOL_HARD_GATE_POLICY);
    expect(execute).toHaveBeenCalledWith(args, expect.anything());
  });

  it('does not ask again in the same turn after a denial, even with new arguments or a sibling tool', async () => {
    const kick = vi.fn(async () => 'kicked');
    const mute = vi.fn(async () => 'muted');
    const port = scriptedPort([{ status: 'denied', by: 'user' }]);
    const audit = auditSink();
    const { turn } = fixture({ approval: port });
    const runtime = new TurnToolRuntime(turn, [tool('group_kick', kick, 'never'), tool('set_mute', mute, 'never')], { decisionAudit: audit });

    await expect(runtime.execute('group_kick', { user_id: 1 }, 'tu-1')).resolves.toMatchObject({ status: 'denied' });
    await expect(runtime.execute('group_kick', { user_id: 2 }, 'tu-2')).resolves.toMatchObject({ status: 'denied' });
    await expect(runtime.execute('set_mute', { user_id: 1 }, 'tu-3')).resolves.toMatchObject({ status: 'denied' });

    expect(port.requests).toHaveLength(1);
    expect(kick).not.toHaveBeenCalled();
    expect(mute).not.toHaveBeenCalled();
    expect(audit.codes()).toEqual([
      'tool_approval:defer:tool_approval_requested',
      'tool_approval:deny:tool_approval_denied',
      'tool_hard_gate:deny:tool_approval_denied',
      'tool_hard_gate:deny:tool_hard_gate_latched',
      'tool_hard_gate:deny:tool_hard_gate_latched',
    ]);
  });

  it('times out to a denial', async () => {
    const port = scriptedPort([]);
    const audit = auditSink();
    // The owner passes the trust-level policy; the hard gate still applies to them.
    const { turn } = fixture({ approval: port, roles: ['master'] });
    const execute = vi.fn(async () => 'posted');
    const runtime = new TurnToolRuntime(turn, [tool('send_group_notice', execute, 'never')], {
      hardGate: { approvalTimeoutMs: 20 },
      decisionAudit: audit,
    });

    const outcome = await runtime.execute('send_group_notice', { content: 'hi' }, 'tu-1');

    expect(outcome).toMatchObject({ status: 'denied', policy: TOOL_HARD_GATE_POLICY });
    expect((outcome as { reason: string }).reason).toContain('审批超时');
    expect(execute).not.toHaveBeenCalled();
    expect(audit.codes()).toContain('tool_hard_gate:deny:tool_approval_timeout');
  });

  it('fails closed in unattended turns, leaves a Console card, and runs it once after an operator approves', async () => {
    const queue = new ToolApprovalQueue();
    const audit = auditSink();
    const execute = vi.fn(async () => 'kicked');
    const capabilities = [tool('group_kick', execute, 'never')];
    const first = new TurnToolRuntime(fixture({ unattended: true }).turn, capabilities, { approvalQueue: queue, decisionAudit: audit });

    await expect(first.execute('group_kick', { user_id: 1 }, 'tu-1')).resolves.toMatchObject({ status: 'denied' });
    const [card] = queue.list({ status: 'pending' });
    expect(card).toMatchObject({ toolName: 'group_kick', category: 'member', args: { user_id: 1 } });
    expect(audit.codes()).toEqual([
      'tool_approval:defer:tool_approval_requested',
      'tool_hard_gate:deny:tool_dangerous_no_approval',
    ]);

    // A retry before anyone approved reuses the same card instead of stacking new ones.
    const retry = new TurnToolRuntime(fixture({ unattended: true, turnId: 'turn-2' }).turn, capabilities, { approvalQueue: queue });
    await expect(retry.execute('group_kick', { user_id: 1 }, 'tu-2')).resolves.toMatchObject({ status: 'denied' });
    expect(queue.list({ status: 'pending' })).toHaveLength(1);

    expect(queue.resolve(card!.id, true, 'console-admin')).toMatchObject({ status: 'approved', decidedBy: 'console-admin' });

    const other = new TurnToolRuntime(fixture({ unattended: true, turnId: 'turn-3' }).turn, capabilities, { approvalQueue: queue });
    await expect(other.execute('group_kick', { user_id: 2 }, 'tu-3')).resolves.toMatchObject({ status: 'denied' });
    expect(execute).not.toHaveBeenCalled();

    const approved = new TurnToolRuntime(fixture({ unattended: true, turnId: 'turn-4' }).turn, capabilities, { approvalQueue: queue, decisionAudit: audit });
    await expect(approved.execute('group_kick', { user_id: 1 }, 'tu-4')).resolves.toMatchObject({ status: 'completed' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(audit.records.at(-2)).toMatchObject({ kind: 'tool_approval', outcome: 'allow', reasonCode: 'tool_approval_approved', actor: 'operator', actorId: 'console-admin' });
    expect(audit.records.at(-1)).toMatchObject({ kind: 'tool_hard_gate', outcome: 'allow', reasonCode: 'tool_approval_approved', actor: 'policy' });

    // The approval is one-shot.
    const again = new TurnToolRuntime(fixture({ unattended: true, turnId: 'turn-5' }).turn, capabilities, { approvalQueue: queue });
    await expect(again.execute('group_kick', { user_id: 1 }, 'tu-5')).resolves.toMatchObject({ status: 'denied' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('lets a Console decision settle a call that is waiting on the IM prompt', async () => {
    const queue = new ToolApprovalQueue();
    const port = scriptedPort([]);
    const execute = vi.fn(async () => 'done');
    const { turn } = fixture({ approval: port });
    const runtime = new TurnToolRuntime(turn, [tool('set_avatar', execute, 'never')], { approvalQueue: queue });

    const pending = runtime.execute('set_avatar', { url: 'https://example.test/a.png' }, 'tu-1');
    await vi.waitFor(() => expect(queue.list({ status: 'pending' })).toHaveLength(1));
    queue.resolve(queue.list({ status: 'pending' })[0]!.id, true, 'op-1');

    await expect(pending).resolves.toMatchObject({ status: 'completed' });
    expect(port.aborted()).toBe(true);
    expect(queue.list()[0]!.status).toBe('consumed');
  });

  it('keeps funds tools disabled unless the Host enables them, then still asks', async () => {
    const execute = vi.fn(async () => 'paid');
    const port = scriptedPort([{ status: 'approved', decision: 'approve-once' }]);
    const disabled = new TurnToolRuntime(fixture({ approval: port, roles: ['master'] }).turn, [tool('send_red_packet', execute, 'never')]);
    await expect(disabled.execute('send_red_packet', { amount: 1 }, 'tu-1')).resolves.toMatchObject({ status: 'denied' });
    expect(port.requests).toHaveLength(0);

    const enabled = new TurnToolRuntime(fixture({ approval: port, roles: ['master'] }).turn, [tool('send_red_packet', execute, 'never')], {
      hardGate: { allowFunds: true },
    });
    await expect(enabled.execute('send_red_packet', { amount: 1 }, 'tu-2')).resolves.toMatchObject({ status: 'completed' });
    expect(port.requests).toHaveLength(1);
  });

  it('leaves safe tools on the ordinary approval path', async () => {
    const execute = vi.fn(async () => 'members');
    const port = scriptedPort([]);
    const audit = auditSink();
    const runtime = new TurnToolRuntime(fixture({ approval: port }).turn, [tool('get_group_members', execute, 'never')], { decisionAudit: audit });
    await expect(runtime.execute('get_group_members', {}, 'tu-1')).resolves.toMatchObject({ status: 'completed' });
    expect(port.requests).toHaveLength(0);
    // Read-only queries are allowed but still audited (ADR 0036).
    expect(audit.codes()).toEqual(['tool_call:allow:tool_safe_allowed']);
  });

  it('never lets an audit failure change the decision', async () => {
    const execute = vi.fn(async () => 'kicked');
    const port = scriptedPort([{ status: 'approved', decision: 'approve-once' }]);
    const runtime = new TurnToolRuntime(fixture({ approval: port }).turn, [tool('group_kick', execute, 'never')], {
      decisionAudit: { record: () => { throw new Error('db down'); } },
    });
    await expect(runtime.execute('group_kick', { user_id: 1 }, 'tu-1')).resolves.toMatchObject({ status: 'completed' });
  });
});

describe('TurnToolRuntime hard gate × IM approval channel (G6, #1013)', () => {
  const imApproval = { enabled: true, approverIds: { icqq: ['admin-1'] } };

  it('records where the call came from on the card so the IM channel can deliver it', async () => {
    const queue = new ToolApprovalQueue();
    const audit = auditSink();
    const runtime = new TurnToolRuntime(fixture({ unattended: true }).turn, [tool('group_kick', vi.fn(async () => 'kicked'), 'never')], {
      approvalQueue: queue,
      decisionAudit: audit,
      hardGate: { imApproval },
    });

    const outcome = await runtime.execute('group_kick', { user_id: 1 }, 'tu-1');

    expect((outcome as { reason: string }).reason).toContain('Console 或 IM 审批通道');
    expect(queue.list()[0]!.origin).toEqual({ platform: 'icqq', endpointKey: '10001', scope: 'group', sceneId: '42' });
    expect(audit.records[0]).toMatchObject({ reasonCode: 'tool_approval_requested', payload: expect.objectContaining({ imApproval: true }) });
  });

  it('keeps the Console-only hint when the IM channel is off', async () => {
    const queue = new ToolApprovalQueue();
    const runtime = new TurnToolRuntime(fixture({ unattended: true }).turn, [tool('group_kick', vi.fn(async () => 'kicked'), 'never')], {
      approvalQueue: queue,
    });
    const outcome = await runtime.execute('group_kick', { user_id: 1 }, 'tu-1');
    expect((outcome as { reason: string }).reason).toContain('需管理员在 Console 批准');
  });

  it('lets an IM approval settle a call that is waiting, and audits the channel and the approver', async () => {
    const queue = new ToolApprovalQueue();
    const audit = auditSink();
    const execute = vi.fn(async () => 'kicked');
    const runtime = new TurnToolRuntime(fixture({ approval: scriptedPort([]) }).turn, [tool('group_kick', execute, 'never')], {
      approvalQueue: queue,
      decisionAudit: audit,
      hardGate: { imApproval },
    });

    const pending = runtime.execute('group_kick', { user_id: 1 }, 'tu-1');
    await vi.waitFor(() => expect(queue.list({ status: 'pending' })).toHaveLength(1));
    queue.resolve(queue.list({ status: 'pending' })[0]!.id, true, 'im:icqq:admin-1', { channel: 'im_dm' });

    await expect(pending).resolves.toMatchObject({ status: 'completed' });
    expect(execute).toHaveBeenCalledTimes(1);
    const approval = audit.records.find((record) => record.kind === 'tool_approval' && record.outcome === 'allow');
    expect(approval).toMatchObject({
      actor: 'operator',
      actorId: 'im:icqq:admin-1',
      payload: expect.objectContaining({ channel: 'im_dm', via: 'im_dm' }),
    });
  });

  it('audits an IM denial with its channel and fails closed', async () => {
    const queue = new ToolApprovalQueue();
    const audit = auditSink();
    const execute = vi.fn(async () => 'kicked');
    const runtime = new TurnToolRuntime(fixture({ approval: scriptedPort([]) }).turn, [tool('group_kick', execute, 'never')], {
      approvalQueue: queue,
      decisionAudit: audit,
      hardGate: { imApproval },
    });

    const pending = runtime.execute('group_kick', { user_id: 1 }, 'tu-1');
    await vi.waitFor(() => expect(queue.list({ status: 'pending' })).toHaveLength(1));
    queue.resolve(queue.list({ status: 'pending' })[0]!.id, false, 'im:icqq:admin-1', { channel: 'im_approver_group' });

    await expect(pending).resolves.toMatchObject({ status: 'denied', policy: TOOL_HARD_GATE_POLICY });
    expect(execute).not.toHaveBeenCalled();
    expect(audit.records.find((record) => record.reasonCode === 'tool_approval_denied' && record.kind === 'tool_approval'))
      .toMatchObject({ actorId: 'im:icqq:admin-1', payload: expect.objectContaining({ channel: 'im_approver_group' }) });
  });

  it('runs an IM-approved unattended card once, for the same arguments only, and audits its channel', async () => {
    const queue = new ToolApprovalQueue();
    const audit = auditSink();
    const execute = vi.fn(async () => 'kicked');
    const capabilities = [tool('group_kick', execute, 'never')];
    const options = { approvalQueue: queue, decisionAudit: audit, hardGate: { imApproval } };
    await new TurnToolRuntime(fixture({ unattended: true }).turn, capabilities, options).execute('group_kick', { user_id: 1 }, 'tu-1');
    const card = queue.list({ status: 'pending' })[0]!;
    queue.resolve(card.id, true, 'im:icqq:admin-1', { channel: 'im_dm' });

    const changed = new TurnToolRuntime(fixture({ unattended: true, turnId: 'turn-2' }).turn, capabilities, options);
    await expect(changed.execute('group_kick', { user_id: 2 }, 'tu-2')).resolves.toMatchObject({ status: 'denied' });
    const same = new TurnToolRuntime(fixture({ unattended: true, turnId: 'turn-3' }).turn, capabilities, options);
    await expect(same.execute('group_kick', { user_id: 1 }, 'tu-3')).resolves.toMatchObject({ status: 'completed' });
    const again = new TurnToolRuntime(fixture({ unattended: true, turnId: 'turn-4' }).turn, capabilities, options);
    await expect(again.execute('group_kick', { user_id: 1 }, 'tu-4')).resolves.toMatchObject({ status: 'denied' });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(audit.records.find((record) => record.kind === 'tool_approval' && record.outcome === 'allow'))
      .toMatchObject({ actorId: 'im:icqq:admin-1', payload: expect.objectContaining({ channel: 'im_dm', via: 'im_dm' }) });
  });

  it('still never lets bypass approve a dangerous tool when the IM channel is on', async () => {
    const queue = new ToolApprovalQueue();
    const execute = vi.fn(async () => 'kicked');
    const runtime = new TurnToolRuntime(fixture({ approval: createBypassApprovalPort() }).turn, [tool('group_kick', execute, 'never')], {
      approvalQueue: queue,
      hardGate: { imApproval, approvalTimeoutMs: 30 },
    });
    await expect(runtime.execute('group_kick', { user_id: 1 }, 'tu-1')).resolves.toMatchObject({ status: 'denied' });
    expect(execute).not.toHaveBeenCalled();
    expect(queue.list()[0]!.status).not.toBe('approved');
  });
});

describe('resolveToolHardGateImApproval', () => {
  it('is off by default and normalizes flat and per-platform approver lists', () => {
    expect(resolveToolHardGateImApproval()).toEqual({ enabled: false, approverIds: {}, delivery: 'dm', approverGroupId: null });
    const flat = resolveToolHardGateImApproval({ enabled: true, approverIds: [' a ', 'a', '', 42 as unknown as string] });
    expect(flat.approverIds).toEqual({ '*': ['a', '42'] });
    const mapped = resolveToolHardGateImApproval({ enabled: true, approverIds: { icqq: ['1'], discord: [], ' ': ['x'] } });
    expect(mapped.approverIds).toEqual({ icqq: ['1'] });
    expect(resolveToolHardGateImApproval({ delivery: 'nope' as never }).delivery).toBe('dm');
    expect(resolveToolHardGateImApproval({ delivery: 'approver_group', approverGroupId: ' 9 ' }).approverGroupId).toBe('9');
  });

  it('only treats allowlisted users of the platform as approvers, and only when enabled', () => {
    const settings = resolveToolHardGateImApproval({ enabled: true, approverIds: { icqq: ['1'], '*': ['2'] } });
    expect(imApproversFor(settings, 'icqq')).toEqual(['1', '2']);
    expect(imApproversFor(settings, 'discord')).toEqual(['2']);
    expect(isImApprover(settings, 'icqq', '1')).toBe(true);
    expect(isImApprover(settings, 'discord', '1')).toBe(false);
    expect(isImApprover(settings, 'icqq', '3')).toBe(false);
    expect(isImApprover({ ...settings, enabled: false }, 'icqq', '1')).toBe(false);
  });

  it('is undeliverable without approvers, without an approver group, or when the group is the business conversation', () => {
    const origin = { platform: 'icqq', endpointKey: '10001', scope: 'group' as const, sceneId: '42' };
    const dm = resolveToolHardGateImApproval({ enabled: true, approverIds: ['1'] });
    expect(isImApprovalDeliverable(dm, origin)).toBe(true);
    expect(isImApprovalDeliverable(dm, null)).toBe(false);
    expect(isImApprovalDeliverable(resolveToolHardGateImApproval({ enabled: true }), origin)).toBe(false);
    const groupless = resolveToolHardGateImApproval({ enabled: true, approverIds: ['1'], delivery: 'approver_group' });
    expect(isImApprovalDeliverable(groupless, origin)).toBe(false);
    const sameGroup = resolveToolHardGateImApproval({ enabled: true, approverIds: ['1'], delivery: 'approver_group', approverGroupId: '42' });
    expect(isImApprovalDeliverable(sameGroup, origin)).toBe(false);
    const otherGroup = resolveToolHardGateImApproval({ enabled: true, approverIds: ['1'], delivery: 'approver_group', approverGroupId: '77' });
    expect(isImApprovalDeliverable(otherGroup, origin)).toBe(true);
  });
});

describe('TurnToolRuntime hard gate × control plane (#1008)', () => {
  it('denies a dangerous tool under emergency_stop without asking for approval', async () => {
    const execute = vi.fn(async () => 'kicked');
    const port = scriptedPort([{ status: 'approved', decision: 'approve-once' }]);
    const queue = new ToolApprovalQueue();
    const audit = auditSink();
    const plane = await controlPlane({ instance: { emergency_stop: true } });
    const runtime = new TurnToolRuntime(fixture({ approval: port }).turn, [tool('foo_remove_member', execute, 'never')], {
      approvalQueue: queue,
      decisionAudit: audit,
      controlPlane: () => plane,
    });

    const outcome = await runtime.execute('foo_remove_member', { user_id: 1 }, 'tu-1');

    expect(outcome).toMatchObject({ status: 'denied', policy: TOOL_HARD_GATE_POLICY });
    expect((outcome as { reason: string }).reason).toContain('急停');
    expect(execute).not.toHaveBeenCalled();
    expect(port.requests).toHaveLength(0);
    expect(queue.list()).toHaveLength(0);
    expect(audit.codes()).toEqual(['tool_hard_gate:deny:control_emergency_stop']);
    expect(audit.records[0]).toMatchObject({ actor: 'policy', payload: expect.objectContaining({ controlSwitch: 'emergency_stop', category: 'member' }) });
  });

  it('denies a dangerous tool when the session is read_only, without asking for approval', async () => {
    const execute = vi.fn(async () => 'renamed');
    const port = scriptedPort([{ status: 'approved', decision: 'approve-once' }]);
    const audit = auditSink();
    const plane = await controlPlane({ sessions: [{ platform: 'icqq', sceneId: 'group:42', flags: { read_only: true } }] });
    const runtime = new TurnToolRuntime(fixture({ approval: port }).turn, [tool('set_group_card', execute, 'never')], {
      decisionAudit: audit,
      controlPlane: () => plane,
    });

    const outcome = await runtime.execute('set_group_card', { user_id: 1, card: 'x' }, 'tu-1');

    expect(outcome).toMatchObject({ status: 'denied', policy: TOOL_HARD_GATE_POLICY });
    expect(execute).not.toHaveBeenCalled();
    expect(port.requests).toHaveLength(0);
    expect(audit.codes()).toEqual(['tool_hard_gate:deny:control_read_only']);
  });

  it('only applies read_only to the overridden session', async () => {
    const execute = vi.fn(async () => 'kicked');
    const port = scriptedPort([{ status: 'approved', decision: 'approve-once' }]);
    const plane = await controlPlane({ sessions: [{ platform: 'icqq', sceneId: 'group:other', flags: { read_only: true } }] });
    const runtime = new TurnToolRuntime(fixture({ approval: port }).turn, [tool('group_kick', execute, 'never')], {
      controlPlane: () => plane,
    });

    await expect(runtime.execute('group_kick', { user_id: 1 }, 'tu-1')).resolves.toMatchObject({ status: 'completed' });
    expect(port.requests).toHaveLength(1);
  });

  it('lets muted sessions still reach the hard-gate approval path (ADR 0036)', async () => {
    const execute = vi.fn(async () => 'muted');
    const port = scriptedPort([{ status: 'approved', decision: 'approve-once' }]);
    const audit = auditSink();
    const plane = await controlPlane({ instance: { muted: true, mention_only: true } });
    const runtime = new TurnToolRuntime(fixture({ approval: port }).turn, [tool('lark_mute_member', execute, 'never')], {
      decisionAudit: audit,
      controlPlane: () => plane,
    });

    await expect(runtime.execute('lark_mute_member', { user_id: 1 }, 'tu-1')).resolves.toMatchObject({ status: 'completed' });
    expect(port.requests).toHaveLength(1);
    expect(port.requests[0]).toMatchObject({ humanOnly: true, toolName: 'lark_mute_member' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(audit.codes()).toEqual([
      'tool_approval:defer:tool_approval_requested',
      'tool_approval:allow:tool_approval_approved',
      'tool_hard_gate:allow:tool_approval_approved',
    ]);
  });

  it('fails closed when the control state is unavailable', async () => {
    const execute = vi.fn(async () => 'kicked');
    const port = scriptedPort([{ status: 'approved', decision: 'approve-once' }]);
    const audit = auditSink();
    const plane = new AiControlPlane();
    await plane.upgradeToDatabase(failingControlModel());
    expect(plane.available).toBe(false);
    const runtime = new TurnToolRuntime(fixture({ approval: port }).turn, [tool('group_kick', execute, 'never')], {
      decisionAudit: audit,
      controlPlane: () => plane,
    });

    await expect(runtime.execute('group_kick', { user_id: 1 }, 'tu-1')).resolves.toMatchObject({ status: 'denied' });
    expect(execute).not.toHaveBeenCalled();
    expect(port.requests).toHaveLength(0);
    expect(audit.codes()).toEqual(['tool_hard_gate:deny:control_emergency_stop']);
  });

  it('fails closed when reading the control plane throws', async () => {
    const execute = vi.fn(async () => 'kicked');
    const port = scriptedPort([{ status: 'approved', decision: 'approve-once' }]);
    const broken: ToolHardGateControlView = {
      isEmergencyStopped: () => { throw new Error('boom'); },
      isReadOnly: () => false,
    };
    const runtime = new TurnToolRuntime(fixture({ approval: port }).turn, [tool('group_kick', execute, 'never')], {
      controlPlane: () => broken,
    });

    await expect(runtime.execute('group_kick', { user_id: 1 }, 'tu-1')).resolves.toMatchObject({ status: 'denied' });
    expect(port.requests).toHaveLength(0);
  });

  it('reads the control plane from the Host live, and skips it for Hosts without one', async () => {
    const plane = new AiControlPlane();
    const source = hostControlPlaneSource({ getControlPlane: () => plane });
    expect(source?.()?.isEmergencyStopped('icqq', 'group:42')).toBe(false);
    await plane.set({ expectedRevision: 0, actorId: 'op-1', instance: { emergency_stop: true } });
    expect(source?.()?.isEmergencyStopped('icqq', 'group:42')).toBe(true);
    expect(hostControlPlaneSource({ controlPlane: plane })?.()).toBe(plane);
    expect(hostControlPlaneSource({})).toBeUndefined();
  });

  it('does not block safe tools under emergency_stop (ingress / outbound gates own that)', async () => {
    const execute = vi.fn(async () => 'members');
    const plane = await controlPlane({ instance: { emergency_stop: true } });
    const runtime = new TurnToolRuntime(fixture().turn, [tool('foo_list_members', execute, 'never')], {
      controlPlane: () => plane,
    });

    await expect(runtime.execute('foo_list_members', {}, 'tu-1')).resolves.toMatchObject({ status: 'completed' });
  });
});

describe('ToolHardGate.checkPreApproved (ADR 0037 slice B announcements)', () => {
  function gate(options: { control?: ToolHardGateControlView; approval?: ApprovalOutcomePort } = {}) {
    const audit = auditSink();
    const queue = new ToolApprovalQueue();
    const enqueue = vi.spyOn(queue, 'enqueue');
    const hardGate = new ToolHardGate(undefined, {
      turnId: 'turn-a',
      sessionKey: 'announcement:a-1',
      unattended: true,
      signal: new AbortController().signal,
      location: { instanceId: '*', platform: 'icqq', sceneId: 'group:123' },
      audit,
      queue,
      ...(options.approval ? { approval: options.approval } : {}),
      ...(options.control ? { controlPlane: () => options.control } : {}),
    });
    return { hardGate, audit, enqueue };
  }
  const approval = { source: 'announcement' as const, id: 'a-1', approvedBy: 'boss', approvedHash: 'h1', contentHash: 'h1' };

  it('treats the announcement approval as the hard-gate approval: no second card, no approval prompt', () => {
    const port = scriptedPort([{ status: 'denied' }]);
    const { hardGate, audit, enqueue } = gate({ approval: port });
    const result = hardGate.checkPreApproved({ name: 'send_group_notice' }, { content: 'hi' }, 'announcement:a-1', approval);
    expect(result).toMatchObject({ status: 'approved', category: 'publish', approvalId: 'a-1' });
    expect(enqueue).not.toHaveBeenCalled();
    expect(port.requests).toHaveLength(0);
    expect(audit.codes()).toEqual([
      'tool_approval:allow:tool_approval_approved',
      'tool_hard_gate:allow:tool_approval_approved',
    ]);
    expect(audit.records[0]).toMatchObject({ actor: 'operator', actorId: 'boss' });
    expect(audit.records[0]!.payload).toMatchObject({ via: 'announcement', approvalId: 'a-1' });
  });

  it('refuses when the content hash no longer matches the approved hash', () => {
    const { hardGate, audit, enqueue } = gate();
    const result = hardGate.checkPreApproved({ name: 'send_group_notice' }, { content: 'changed' }, 't', { ...approval, contentHash: 'h2' });
    expect(result).toMatchObject({ status: 'denied', reasonCode: 'announcement_hash_mismatch' });
    expect(enqueue).not.toHaveBeenCalled();
    expect(audit.codes()).toEqual(['tool_hard_gate:deny:announcement_hash_mismatch']);
    const missing = gate().hardGate.checkPreApproved({ name: 'send_group_notice' }, {}, 't', { ...approval, approvedHash: null });
    expect(missing).toMatchObject({ status: 'denied', reasonCode: 'announcement_hash_mismatch' });
  });

  it('still honours emergency_stop / read_only', () => {
    const control: ToolHardGateControlView = { isEmergencyStopped: () => true, isReadOnly: () => false };
    const { hardGate, enqueue } = gate({ control });
    const result = hardGate.checkPreApproved({ name: 'send_group_notice' }, {}, 't', approval);
    expect(result).toMatchObject({ status: 'denied', reasonCode: 'control_emergency_stop' });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('ToolApprovalQueue', () => {
  it('expires pending cards after the ttl', async () => {
    vi.useFakeTimers();
    const queue = new ToolApprovalQueue({ ttlMs: 1_000 });
    const card = queue.enqueue({ toolName: 'set_mute', category: 'member', sessionKey: 's', turnId: 't', args: { token: 'secret-value' } });
    expect(card.args).toEqual({ token: '[redacted]' });
    const settled = queue.wait(card.id);
    vi.advanceTimersByTime(1_001);
    await expect(settled).resolves.toBe('expired');
    expect(queue.resolve(card.id, true, 'op')).toBeUndefined();
  });

  it('notifies listeners of new cards only, and a failing listener never breaks enqueue', () => {
    const queue = new ToolApprovalQueue();
    const seen: string[] = [];
    queue.onEnqueue(() => { throw new Error('listener down'); });
    const stop = queue.onEnqueue((entry) => { seen.push(entry.id); });
    const input = { toolName: 'set_mute', category: 'member' as const, sessionKey: 's', turnId: 't', args: { user_id: 1 } };

    const first = queue.enqueue(input);
    const reused = queue.enqueue(input);
    stop();
    queue.enqueue({ ...input, args: { user_id: 2 } });

    expect(reused.id).toBe(first.id);
    expect(seen).toEqual([first.id]);
  });

  it('settles a card once: the first channel wins and records itself; later answers are rejected', async () => {
    const queue = new ToolApprovalQueue();
    const card = queue.enqueue({ toolName: 'set_mute', category: 'member', sessionKey: 's', turnId: 't', args: {} });
    const settled = queue.wait(card.id);

    expect(queue.resolve(card.id, true, 'im:icqq:1', { channel: 'im_dm' })).toMatchObject({ status: 'approved', channel: 'im_dm', decidedBy: 'im:icqq:1' });
    expect(queue.resolve(card.id, false, 'console', { channel: 'console' })).toBeUndefined();
    await expect(settled).resolves.toBe('approved');
    expect(queue.get(card.id)).toMatchObject({ status: 'approved', channel: 'im_dm' });
  });

  it('leaves the channel empty for timeouts', async () => {
    vi.useFakeTimers();
    const queue = new ToolApprovalQueue({ ttlMs: 1_000 });
    const card = queue.enqueue({ toolName: 'set_mute', category: 'member', sessionKey: 's', turnId: 't', args: {} });
    vi.advanceTimersByTime(1_001);
    expect(queue.get(card.id)).toMatchObject({ status: 'expired', channel: null, decidedBy: null });
  });
});

function tool(name: string, execute: (...args: any[]) => Promise<unknown>, requiresApproval: ToolCapability['requiresApproval']): ToolCapability {
  return {
    owner: rootPluginId(),
    name,
    qualifiedName: name,
    description: name,
    requiresApproval,
    source: `/tools/${name}.ts`,
    execute: execute as ToolCapability['execute'],
  };
}

function fixture(options: { approval?: ApprovalOutcomePort; unattended?: boolean; turnId?: string; roles?: string[] } = {}) {
  const events: TurnEvent[] = [];
  const turn = createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: options.turnId ?? 'turn' },
    origin: { kind: 'im', platform: 'icqq', endpoint: '10001', scope: 'group', sceneId: '42' },
    principal: { subjectId: 'user-1', roles: options.roles ?? ['user'] },
    input: { text: 'run' },
    session: { key: 'icqq:10001:group:42' },
    policy: { permissions: options.roles ?? ['user'], unattended: options.unattended ?? false },
    capabilities: { tools: [], skills: [] },
    signal: new AbortController().signal,
    ports: {
      journal: { append: (event) => { events.push(event); } },
      ...(options.approval && !options.unattended ? { approval: options.approval } : {}),
    },
  });
  return { turn, events };
}

/** Answers with the scripted outcomes in order; with none left it never answers (until aborted). */
function scriptedPort(outcomes: ApprovalOutcome[]) {
  const requests: ApprovalRequestInput[] = [];
  let aborted = false;
  const port: ApprovalOutcomePort & { requests: ApprovalRequestInput[]; aborted(): boolean } = {
    available: true,
    requests,
    aborted: () => aborted,
    requestApproval: async () => false,
    requestApprovalOutcome: (input) => {
      requests.push(input);
      const next = outcomes.shift();
      if (next) return Promise.resolve(next);
      return new Promise((resolve) => {
        input.signal.addEventListener('abort', () => {
          aborted = true;
          resolve({ status: 'unavailable', reason: 'aborted' });
        }, { once: true });
      });
    },
  };
  return port;
}

function auditSink() {
  const records: DecisionEventRecord[] = [];
  return {
    records,
    // Validates every row the same way the slice-B writer does.
    record(input: DecisionEventInput) { records.push(createDecisionEvent(input)); },
    codes: () => records.map((record) => `${record.kind}:${record.outcome}:${record.reasonCode}`),
  };
}

async function controlPlane(input: {
  instance?: Parameters<AiControlPlane['set']>[0]['instance'];
  sessions?: Parameters<AiControlPlane['set']>[0]['sessions'];
}): Promise<AiControlPlane> {
  const plane = new AiControlPlane();
  await plane.set({ expectedRevision: 0, actorId: 'op-1', ...input });
  return plane;
}

function failingControlModel(): ControlStateModel {
  const failingSelect = {
    where: () => Promise.reject(new Error('db down')),
    then: (_resolve: unknown, reject: (reason: unknown) => void) => reject(new Error('db down')),
  };
  return {
    select: () => failingSelect as unknown as ReturnType<ControlStateModel['select']>,
    create: () => Promise.reject(new Error('db down')),
    update: () => ({ where: () => Promise.reject(new Error('db down')) }),
  };
}
