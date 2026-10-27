import { describe, expect, it, vi } from 'vitest';
import { AiControlPlane, AiSessionOps, DecisionEventLog, SessionProfileStore } from '@zhin.js/agent';
import { MemoryConversationEventStore, type ConversationEvent } from '@zhin.js/im-contract';
import { MemberLifecycle, WELCOME_PREVIEW_SAMPLE } from '../../../../src/plugin-runtime/agent/turn/member-lifecycle.js';
import { SceneEventIngress } from '../../../../src/plugin-runtime/agent/turn/scene-event-ingress.js';

const endpoint = Object.freeze({ id: 'icqq', adapter: 'icqq' });
const group = Object.freeze({ endpoint, kind: 'group' as const, id: 'g1' });
const BOT = '10000';

function fakeTimers() {
  let now = 1_000_000;
  const timers: { at: number; run: () => void; id: number }[] = [];
  let nextId = 1;
  return {
    now: () => now,
    setTimer: (run: () => void, ms: number) => { const id = nextId++; timers.push({ at: now + ms, run, id }); return id; },
    clearTimer: (id: unknown) => { const index = timers.findIndex((timer) => timer.id === id); if (index >= 0) timers.splice(index, 1); },
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        timers.sort((left, right) => left.at - right.at);
        const next = timers[0];
        if (!next || next.at > target) break;
        timers.shift();
        now = next.at;
        next.run();
        for (let i = 0; i < 20; i++) await Promise.resolve();
      }
      now = target;
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
  };
}

let seq = 0;
function ev(type: string, extra: Record<string, unknown>): ConversationEvent {
  seq += 1;
  return { eventId: `m${seq}`, conversation: group, timestamp: Date.now(), type, ...extra } as unknown as ConversationEvent;
}

async function harness(options: {
  welcome?: Record<string, unknown>;
  leave?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  control?: (plane: AiControlPlane) => Promise<unknown>;
  send?: () => Promise<any>;
} = {}) {
  const clock = fakeTimers();
  const store = new MemoryConversationEventStore();
  const log = new DecisionEventLog();
  const sessions = new SessionProfileStore();
  const ops = new AiSessionOps();
  const plane = new AiControlPlane();
  if (options.welcome || options.leave || options.defaults) {
    await ops.set({
      expectedRevision: 0,
      actorId: 'console',
      ...(options.defaults ? { defaults: options.defaults } : {}),
      sessions: [{ platform: 'icqq', sceneId: 'group:g1', ...(options.welcome ? { welcome: options.welcome } : {}), ...(options.leave ? { leave: options.leave } : {}) }],
    });
  }
  await options.control?.(plane);
  const send = vi.fn(options.send ?? (async () => ({ status: 'sent' as const, messageId: 'out1' })));
  const lifecycle = new MemberLifecycle({
    sessionOps: () => ops,
    controlPlane: () => plane,
    sessions: () => sessions,
    reader: () => store,
    decisionEvents: () => log,
    send,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const emit = async (event: ConversationEvent) => {
    const { sequence } = await store.append(event);
    return lifecycle.handle({ sequence, event, selfIds: [BOT], endpointId: BOT });
  };
  const rows = async () => { await log.idle(); return log.recent().map((r) => [r.kind, r.outcome, r.reasonCode]); };
  return { clock, store, log, sessions, ops, plane, send, lifecycle, emit, rows };
}

const join = (id: string, name?: string) => ev('member.joined', { member: { id, ...(name ? { displayName: name } : {}) } });

describe('MemberLifecycle — welcome (ADR 0037 §1.1)', () => {
  it('disabled by default: records the join as welcome_disabled and sends nothing', async () => {
    const flow = await harness();
    expect(await flow.emit(join('u1'))).toBe('welcome_disabled');
    await flow.clock.advance(120_000);
    expect(flow.send).not.toHaveBeenCalled();
    expect(await flow.rows()).toEqual([['member_lifecycle', 'skip', 'welcome_disabled']]);
  });

  it('merges joins inside the window into one welcome with whitelisted vars', async () => {
    const flow = await harness({ welcome: { enabled: true, template: '欢迎 {members}（{nickname}）来到 {group}，群规 {rules_url} {oops}', rulesUrl: 'https://r' } });
    expect(await flow.emit(join('u1', '阿强'))).toBe('welcome_scheduled');
    await flow.clock.advance(30_000);
    expect(await flow.emit(join('u2', '小美'))).toBe('welcome_merged');
    await flow.clock.advance(29_999);
    expect(flow.send).not.toHaveBeenCalled();
    await flow.clock.advance(1);
    expect(flow.send).toHaveBeenCalledOnce();
    const parts = flow.send.mock.calls[0]![1];
    expect(parts).toEqual([
      { type: 'text', text: '欢迎 ' },
      { type: 'mention', id: 'u1', name: '阿强' },
      { type: 'text', text: ' ' },
      { type: 'mention', id: 'u2', name: '小美' },
      { type: 'text', text: '（阿强、小美）来到 g1，群规 https://r {oops}' },
    ]);
    expect(await flow.rows()).toEqual([
      ['member_lifecycle', 'defer', 'welcome_merged'],
      ['outbound', 'allow', 'outbound_sent'],
      ['member_lifecycle', 'allow', 'welcome_sent'],
    ]);
    expect(flow.lifecycle.lastResult).toEqual({ kind: 'sent', members: 2 });
    // 合并行与发送行串在同一个 turn_id 上，回放可按 turn_id 定位。
    expect(new Set(flow.log.recent().map((row) => row.turnId)).size).toBe(1);
  });

  it('caps welcomes per hour and audits welcome_rate_limited', async () => {
    const flow = await harness({ welcome: { enabled: true, mergeWindowMs: 0, maxPerHour: 2 } });
    for (const id of ['u1', 'u2', 'u3']) {
      await flow.emit(join(id));
      await flow.clock.advance(1_000);
    }
    expect(flow.send).toHaveBeenCalledTimes(2);
    expect((await flow.rows()).filter(([kind]) => kind === 'member_lifecycle')).toEqual([
      ['member_lifecycle', 'allow', 'welcome_sent'],
      ['member_lifecycle', 'allow', 'welcome_sent'],
      ['member_lifecycle', 'skip', 'welcome_rate_limited'],
    ]);
    // 一小时后额度恢复。
    await flow.clock.advance(60 * 60 * 1000);
    await flow.emit(join('u4'));
    await flow.clock.advance(1);
    expect(flow.send).toHaveBeenCalledTimes(3);
  });

  it('control plane blocks the welcome before session-gate with control_* codes', async () => {
    const flow = await harness({
      welcome: { enabled: true, mergeWindowMs: 0 },
      control: (plane) => plane.set({ expectedRevision: 0, sessions: [{ platform: 'icqq', sceneId: 'group:g1', flags: { muted: true } }], actorId: 'op' }),
    });
    const observe = vi.spyOn(flow.sessions, 'observeInbound');
    await flow.emit(join('u1'));
    await flow.clock.advance(1);
    expect(flow.send).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
    expect(await flow.rows()).toEqual([
      ['control_gate', 'deny', 'control_muted_session'],
      ['member_lifecycle', 'skip', 'control_muted_session'],
    ]);
    expect(flow.lifecycle.lastResult).toEqual({ kind: 'skipped', reason: 'control:muted' });
  });

  it('mention_only does not block template welcome (Fin; includes cold-field temp)', async () => {
    const flow = await harness({
      welcome: { enabled: true, mergeWindowMs: 0 },
      control: (plane) => plane.set({ expectedRevision: 0, sessions: [{ platform: 'icqq', sceneId: 'group:g1', flags: { mention_only: true } }], actorId: 'op' }),
    });
    expect(await flow.emit(join('u1'))).toBe('welcome_scheduled');
    await flow.flush();
    expect(flow.sends).toHaveLength(1);
    const rows = await flow.rows();
    expect(rows.some((r) => r[2] === 'control_mention_only')).toBe(false);
    expect(rows.some((r) => r[0] === 'member_lifecycle' && r[2] === 'welcome_sent')).toBe(true);
  });

  it('emergency_stop blocks too and the welcome is not re-sent later', async () => {
    const flow = await harness({
      welcome: { enabled: true, mergeWindowMs: 0 },
      control: (plane) => plane.set({ expectedRevision: 0, instance: { emergency_stop: true }, actorId: 'op' }),
    });
    await flow.emit(join('u1'));
    await flow.clock.advance(1);
    await flow.plane.set({ expectedRevision: 1, instance: { emergency_stop: false }, actorId: 'op' });
    await flow.clock.advance(120_000);
    expect(flow.send).not.toHaveBeenCalled();
    expect((await flow.rows())[1]).toEqual(['member_lifecycle', 'skip', 'control_emergency_stop']);
  });

  it('session-gate: bot muted in the group → skip with cannot_speak_muted', async () => {
    const flow = await harness({ welcome: { enabled: true, mergeWindowMs: 0 } });
    await flow.store.append(ev('member.muted', { member: { id: BOT }, durationSeconds: 600 }));
    await flow.emit(join('u1'));
    await flow.clock.advance(1);
    expect(flow.send).not.toHaveBeenCalled();
    expect(await flow.rows()).toEqual([
      ['speak_gate', 'deny', 'cannot_speak_muted'],
      ['member_lifecycle', 'skip', 'cannot_speak_muted'],
    ]);
  });

  it('a failed send is audited as an error and never retried', async () => {
    const flow = await harness({
      welcome: { enabled: true, mergeWindowMs: 0 },
      send: async () => ({ status: 'failed' as const, code: 'timeout', retryable: true }),
    });
    await flow.emit(join('u1'));
    await flow.clock.advance(120_000);
    expect(flow.send).toHaveBeenCalledOnce();
    expect(await flow.rows()).toEqual([
      ['outbound', 'error', 'outbound_failed'],
      ['member_lifecycle', 'error', 'outbound_failed'],
    ]);
  });

  it('ignores the bot joining by itself', async () => {
    const flow = await harness({ welcome: { enabled: true } });
    expect(await flow.emit(join(BOT))).toBe('ignored');
    expect(await flow.rows()).toEqual([]);
  });
});

describe('MemberLifecycle — leave', () => {
  it('records member_leave_recorded by default and sends nothing', async () => {
    const flow = await harness();
    expect(await flow.emit(ev('member.left', { member: { id: 'u1' }, actor: { id: 'admin' }, reason: 'removed' }))).toBe('leave_recorded');
    expect(flow.send).not.toHaveBeenCalled();
    await flow.log.idle();
    const [row] = flow.log.recent();
    expect([row!.kind, row!.outcome, row!.reasonCode, row!.userId]).toEqual(['member_lifecycle', 'allow', 'member_leave_recorded', 'u1']);
    expect(row!.payload).toMatchObject({ event: 'member_decrease', memberId: 'u1', reason: 'removed', actorId: 'admin', notify: false });
    expect(row!.sceneId).toBe('group:g1');
  });

  it('leave.record=false writes nothing', async () => {
    const flow = await harness({ leave: { record: false } });
    expect(await flow.emit(ev('member.left', { member: { id: 'u1' }, reason: 'left' }))).toBe('leave_ignored');
    expect(await flow.rows()).toEqual([]);
  });
});

describe('MemberLifecycle — preview', () => {
  it('renders with a sample member when no real join was seen, without sending or auditing', async () => {
    const flow = await harness({ welcome: { template: 'Hi {nickname} {foo}' } });
    const preview = await flow.lifecycle.preview({ platform: 'icqq', sceneId: 'group:g1' });
    expect(preview).toMatchObject({ text: `Hi ${WELCOME_PREVIEW_SAMPLE[0]!.name} {foo}`, unknownVars: ['foo'], sample: true, enabled: false });
    expect(flow.send).not.toHaveBeenCalled();
    expect(await flow.rows()).toEqual([]);
  });

  it('uses the last real join and an override template', async () => {
    const flow = await harness();
    await flow.emit(join('u7', '小王'));
    await flow.log.idle();
    const before = flow.log.recent().length;
    const preview = await flow.lifecycle.preview({ platform: 'icqq', sceneId: 'group:g1', template: '{members} 你好' });
    expect(preview).toMatchObject({ text: '@小王 你好', sample: false });
    await flow.log.idle();
    expect(flow.log.recent().length).toBe(before);
  });
});

describe('scene event wake de-dup with welcome', () => {
  async function wakeHarness(enabled: boolean) {
    const clock = fakeTimers();
    const store = new MemoryConversationEventStore();
    const ops = new AiSessionOps();
    if (enabled) await ops.set({ expectedRevision: 0, actorId: 'console', sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { enabled: true } }] });
    const lifecycle = new MemberLifecycle({
      sessionOps: () => ops, sessions: () => undefined, reader: () => store,
      send: async () => ({ status: 'sent' as const }), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    });
    const executeTurn = vi.fn(async () => ({ status: 'completed' as const }));
    const ingress = new SceneEventIngress({
      projectRoot: '/tmp/project',
      triggerConfig: () => ({ sceneEvents: { conversations: ['icqq:g1'] } }),
      reader: () => store,
      sessions: () => undefined,
      ownsWake: (signal) => lifecycle.ownsWake(signal),
      deliver: vi.fn(async () => ({ status: 'sent' as const })),
      executeTurn: executeTurn as never,
      timeoutMs: () => 10_000,
      now: () => Date.now(),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    const emit = async (event: ConversationEvent) => {
      const { sequence } = await store.append(event);
      return ingress.handle({ sequence, event, selfIds: [BOT], endpointId: BOT });
    };
    return { clock, emit, executeTurn };
  }

  it('welcome.enabled: member.joined no longer wakes the model; member.left still does', async () => {
    const flow = await wakeHarness(true);
    expect(await flow.emit(join('u1'))).toBe('suppressed');
    await flow.clock.advance(10_000);
    expect(flow.executeTurn).not.toHaveBeenCalled();
    expect(await flow.emit(ev('member.left', { member: { id: 'u2' }, reason: 'left' }))).toBe('scheduled');
  });

  it('welcome disabled: behaviour unchanged (join wakes the model)', async () => {
    const flow = await wakeHarness(false);
    expect(await flow.emit(join('u1'))).toBe('scheduled');
    await flow.clock.advance(10_000);
    expect(flow.executeTurn).toHaveBeenCalledOnce();
  });
});
