import { describe, expect, it, vi } from 'vitest';
import { createDecisionEvent, type DecisionEventInput, type DecisionEventRecord } from '../../src/decision-events.js';
import type { ApprovalOutcome, ApprovalOutcomePort, ApprovalRequestInput } from '../../src/session/approval-port.js';
import { AiSessionOps } from '../../src/session-ops.js';
import { MAX_OPS_COOLDOWN_ENTRIES, OpsCooldown, opsCooldownTarget } from '../../src/security/ops-cooldown.js';
import { ToolApprovalQueue } from '../../src/security/tool-approval-queue.js';
import { ToolHardGate, type ToolHardGateControlView } from '../../src/security/tool-hard-gate.js';

/** ADR 0037 §3 / 切片 E（G4）：群管冷却在硬闸生成新审批卡之前判定。 */

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

function auditSink() {
  const records: DecisionEventRecord[] = [];
  return {
    records,
    record(input: DecisionEventInput) { records.push(createDecisionEvent(input)); },
    codes: () => records.map((record) => `${record.kind}:${record.outcome}:${record.reasonCode}`),
  };
}

function scriptedPort(outcomes: ApprovalOutcome[]) {
  const requests: ApprovalRequestInput[] = [];
  const port: ApprovalOutcomePort & { requests: ApprovalRequestInput[] } = {
    available: true,
    requests,
    requestApproval: async () => false,
    requestApprovalOutcome: (input) => {
      requests.push(input);
      return Promise.resolve(outcomes.shift() ?? { status: 'denied' });
    },
  };
  return port;
}

function harness(options: { cooldownMs?: number; resolve?: (platform: string, sceneId: string) => number } = {}) {
  const time = clock();
  const cooldown = new OpsCooldown({
    now: time.now,
    ...(options.resolve ? { resolveCooldownMs: options.resolve } : options.cooldownMs !== undefined ? { resolveCooldownMs: () => options.cooldownMs! } : {}),
  });
  const queue = new ToolApprovalQueue();
  const audit = auditSink();
  let turn = 0;
  /** 每次调用都是一个新回合（新的 ToolHardGate），冷却表跨回合共享。 */
  function gate(input: {
    sceneId?: string;
    platform?: string;
    approval?: ApprovalOutcomePort;
    control?: ToolHardGateControlView;
  } = {}) {
    turn += 1;
    return new ToolHardGate(undefined, {
      turnId: `turn-${turn}`,
      sessionKey: `icqq:10001:${input.sceneId ?? 'group:42'}`,
      requesterId: 'user-1',
      unattended: !input.approval,
      ...(input.approval ? { approval: input.approval } : {}),
      signal: new AbortController().signal,
      location: { instanceId: '10001', platform: input.platform ?? 'icqq', sceneId: input.sceneId ?? 'group:42', userId: 'user-1' },
      audit,
      queue,
      opsCooldown: cooldown,
      ...(input.control ? { controlPlane: () => input.control } : {}),
    });
  }
  return { time, cooldown, queue, audit, gate };
}

describe('OpsCooldown', () => {
  it('defaults to 60s, keys by platform + scene + action, and starts the timer on acquire', () => {
    const time = clock();
    const cooldown = new OpsCooldown({ now: time.now });
    const key = { platform: 'icqq', sceneId: 'group:42', action: 'kick_member' };
    expect(cooldown.acquire(key)).toEqual({ status: 'passed', cooldownMs: 60_000 });
    time.advance(10_000);
    expect(cooldown.acquire(key)).toEqual({ status: 'hit', cooldownMs: 60_000, remainingMs: 50_000, startedAt: 1_000_000 });
    expect(cooldown.acquire({ ...key, action: 'mute_member' }).status).toBe('passed');
    expect(cooldown.acquire({ ...key, sceneId: 'group:43' }).status).toBe('passed');
    expect(cooldown.acquire({ ...key, platform: 'qq' }).status).toBe('passed');
    time.advance(50_000);
    expect(cooldown.remainingMs(key)).toBe(0);
    expect(cooldown.acquire(key).status).toBe('passed');
  });

  it('cooldownMs 0 disables it; bad or throwing resolvers fall back to the default', () => {
    const off = new OpsCooldown({ resolveCooldownMs: () => 0 });
    const key = { platform: 'icqq', sceneId: 'group:42', action: 'kick_member' };
    expect(off.acquire(key)).toEqual({ status: 'passed', cooldownMs: 0 });
    expect(off.acquire(key).status).toBe('passed');
    expect(off.size).toBe(0);
    expect(new OpsCooldown({ resolveCooldownMs: () => Number.NaN }).cooldownMs('icqq', 'group:42')).toBe(60_000);
    expect(new OpsCooldown({ resolveCooldownMs: () => { throw new Error('boom'); } }).cooldownMs('icqq', 'group:42')).toBe(60_000);
  });

  it('reads the duration from session ops (instance default + per-session override)', async () => {
    const ops = new AiSessionOps();
    await ops.set({ expectedRevision: 0, actorId: 'console', defaults: { ops: { cooldownMs: 30_000 } },
      sessions: [{ platform: 'icqq', sceneId: 'group:fast', ops: { cooldownMs: 1_000 } }] });
    const cooldown = new OpsCooldown({ resolveCooldownMs: (platform, sceneId) => ops.resolve(platform, sceneId).ops.cooldownMs });
    expect(cooldown.cooldownMs('icqq', 'group:fast')).toBe(1_000);
    expect(cooldown.cooldownMs('icqq', 'group:other')).toBe(30_000);
  });

  it('caps the number of remembered entries', () => {
    const cooldown = new OpsCooldown({ maxEntries: 3 });
    for (let index = 0; index < 10; index += 1) cooldown.acquire({ platform: 'icqq', sceneId: `group:${index}`, action: 'kick' });
    expect(cooldown.size).toBe(3);
    expect(MAX_OPS_COOLDOWN_ENTRIES).toBeGreaterThan(1_000);
  });

  it('picks a scalar target from common member fields', () => {
    expect(opsCooldownTarget({ user_id: 123 })).toBe('123');
    expect(opsCooldownTarget({ target: ' u-9 ' })).toBe('u-9');
    expect(opsCooldownTarget({ reason: 'spam' })).toBeUndefined();
  });
});

describe('ToolHardGate × ops cooldown (ADR 0037 §3, slice E)', () => {
  it('suppresses a second card within the window and fails closed with the remaining time', async () => {
    const h = harness();
    const first = await h.gate().check({ name: 'kick_member' }, { user_id: 'u1' }, 'call-1');
    expect(first).toMatchObject({ status: 'denied', reasonCode: 'tool_dangerous_no_approval' });
    expect(h.queue.list()).toHaveLength(1);

    h.time.advance(15_000);
    const enqueue = vi.spyOn(h.queue, 'enqueue');
    const second = await h.gate().check({ name: 'kick_member' }, { user_id: 'u2' }, 'call-2');
    expect(second).toMatchObject({ status: 'denied', reasonCode: 'ops_cooldown_hit', category: 'member' });
    expect(second.status === 'denied' && second.reason).toContain('冷却中');
    expect(second.status === 'denied' && second.reason).toContain('45000');
    expect(enqueue).not.toHaveBeenCalled();
    expect(h.queue.list()).toHaveLength(1);

    expect(h.audit.codes()).toEqual([
      'ops_cooldown:allow:ops_cooldown_passed',
      'tool_approval:defer:tool_approval_requested',
      'tool_hard_gate:deny:tool_dangerous_no_approval',
      'ops_cooldown:deny:ops_cooldown_hit',
      'tool_hard_gate:deny:ops_cooldown_hit',
    ]);
    const hit = h.audit.records[3]!;
    expect(hit).toMatchObject({ platform: 'icqq', sceneId: 'group:42', actor: 'policy', turnId: 'turn-2' });
    expect(hit.payload).toMatchObject({ action: 'kick_member', target: 'u2', remainingMs: 45_000, platform: 'icqq', sceneId: 'group:42' });
    expect(h.audit.records[0]!.payload).toMatchObject({ action: 'kick_member', target: 'u1', cooldownMs: 60_000 });
  });

  it('allows a new card once the window has passed', async () => {
    const h = harness();
    await h.gate().check({ name: 'kick_member' }, { user_id: 'u1' }, 'call-1');
    h.time.advance(60_000);
    const again = await h.gate().check({ name: 'kick_member' }, { user_id: 'u2' }, 'call-2');
    expect(again).toMatchObject({ reasonCode: 'tool_dangerous_no_approval' });
    expect(h.queue.list()).toHaveLength(2);
  });

  it('starts the cooldown even when the first card is denied by the approver', async () => {
    const h = harness();
    const port = scriptedPort([{ status: 'denied' }]);
    const first = await h.gate({ approval: port }).check({ name: 'kick_member' }, { user_id: 'u1' }, 'call-1');
    expect(first).toMatchObject({ status: 'denied', reasonCode: 'tool_approval_denied' });
    h.time.advance(1_000);
    const port2 = scriptedPort([{ status: 'approved' }]);
    const retry = await h.gate({ approval: port2 }).check({ name: 'kick_member' }, { user_id: 'u1', reason: 'again' }, 'call-2');
    expect(retry).toMatchObject({ status: 'denied', reasonCode: 'ops_cooldown_hit' });
    expect(port2.requests).toHaveLength(0);
    expect(h.queue.list()).toHaveLength(1);
  });

  it('does not share cooldown across actions, scenes or platforms', async () => {
    const h = harness();
    await h.gate().check({ name: 'kick_member' }, { user_id: 'a' }, 'a');
    const other = [
      await h.gate().check({ name: 'mute_member' }, { user_id: 'b' }, 'b'),
      await h.gate({ sceneId: 'group:43' }).check({ name: 'kick_member' }, { user_id: 'c' }, 'c'),
      await h.gate({ platform: 'qq' }).check({ name: 'kick_member' }, { user_id: 'd' }, 'd'),
    ];
    for (const result of other) expect(result).toMatchObject({ reasonCode: 'tool_dangerous_no_approval' });
    expect(h.queue.list()).toHaveLength(4);
    // 动作按工具本地名：同一本地名的限定名共享冷却。
    const qualified = await h.gate().check({ name: 'icqq__skills__group-admin__kick_member' }, {}, 'e');
    expect(qualified).toMatchObject({ reasonCode: 'ops_cooldown_hit' });
  });

  it('still lets an operator-approved card run once inside the window (that card already started it)', async () => {
    const h = harness();
    await h.gate().check({ name: 'kick_member' }, { user_id: 'u1' }, 'call-1');
    const card = h.queue.list()[0]!;
    h.queue.resolve(card.id, true, 'console', { channel: 'console' });
    h.time.advance(5_000);
    const approved = await h.gate().check({ name: 'kick_member' }, { user_id: 'u1' }, 'call-2');
    expect(approved).toMatchObject({ status: 'approved', approvalId: card.id });
    // 参数不同就是一张新卡，冷却仍在：拒绝。
    const different = await h.gate().check({ name: 'kick_member' }, { user_id: 'u9' }, 'call-3');
    expect(different).toMatchObject({ reasonCode: 'ops_cooldown_hit' });
  });

  it('latches the tool for the rest of the turn after a cooldown hit', async () => {
    const h = harness();
    await h.gate().check({ name: 'kick_member' }, {}, 'a');
    const gate = h.gate();
    expect(await gate.check({ name: 'kick_member' }, {}, 'b')).toMatchObject({ reasonCode: 'ops_cooldown_hit' });
    expect(await gate.check({ name: 'mute_member' }, {}, 'c')).toMatchObject({ reasonCode: 'tool_hard_gate_latched' });
  });

  it('runs after control-plane / funds checks and does not start the timer when those deny', async () => {
    const h = harness();
    const control: ToolHardGateControlView = { isEmergencyStopped: () => true, isReadOnly: () => false };
    expect(await h.gate({ control }).check({ name: 'kick_member' }, {}, 'a')).toMatchObject({ reasonCode: 'control_emergency_stop' });
    expect(await h.gate().check({ name: 'send_red_packet' }, {}, 'b')).toMatchObject({ reasonCode: 'tool_funds_disabled' });
    expect(h.cooldown.size).toBe(0);
    expect(await h.gate().check({ name: 'kick_member' }, {}, 'c')).toMatchObject({ reasonCode: 'tool_dangerous_no_approval' });
  });

  it('honours a per-session cooldown of 0 (off) and leaves safe tools alone', async () => {
    const h = harness({ resolve: (_platform, sceneId) => (sceneId === 'group:off' ? 0 : 60_000) });
    await h.gate({ sceneId: 'group:off' }).check({ name: 'kick_member' }, {}, 'a');
    expect(await h.gate({ sceneId: 'group:off' }).check({ name: 'kick_member' }, {}, 'b'))
      .toMatchObject({ reasonCode: 'tool_dangerous_no_approval' });
    expect(await h.gate().check({ name: 'get_weather' }, {}, 'c')).toEqual({ status: 'safe' });
    expect(h.audit.codes().filter((code) => code.startsWith('ops_cooldown:deny'))).toEqual([]);
  });

  it('skips the cooldown when the Host does not provide one', async () => {
    const queue = new ToolApprovalQueue();
    const make = () => new ToolHardGate(undefined, {
      turnId: 't', sessionKey: 's', unattended: true, signal: new AbortController().signal,
      location: { instanceId: 'i', platform: 'icqq', sceneId: 'group:42' }, queue,
    });
    await make().check({ name: 'kick_member' }, { user_id: 'a' }, 'a');
    await make().check({ name: 'kick_member' }, { user_id: 'b' }, 'b');
    expect(queue.list()).toHaveLength(2);
  });
});
