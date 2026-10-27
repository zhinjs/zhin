import { describe, expect, it, vi } from 'vitest';
import { MemoryConversationEventStore, type ConversationEvent } from '@zhin.js/im-contract';
import { SessionProfileStore } from '@zhin.js/agent';
import { SceneEventWake } from '../../../../src/plugin-runtime/agent/turn/scene-event-wake.js';
import { SceneEventIngress, SCENE_WAKE_INPUT_TEXT } from '../../../../src/plugin-runtime/agent/turn/scene-event-ingress.js';

const endpoint = Object.freeze({ id: 'icqq', adapter: 'icqq' });
const group = Object.freeze({ endpoint, kind: 'group' as const, id: 'g1' });

/** Manual clock + timers so coalesce windows and rate limits are deterministic. */
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
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
      now = target;
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
  };
}

let eventSeq = 0;
function ev(type: string, extra: Record<string, unknown>, timestamp = Date.now()): ConversationEvent {
  eventSeq += 1;
  return { eventId: `e${eventSeq}`, conversation: group, timestamp, type, ...extra } as unknown as ConversationEvent;
}

describe('SceneEventWake (debounce + rate limit)', () => {
  it('coalesces high-priority events of one scene inside the window into one wake', async () => {
    const clock = fakeTimers();
    const onWake = vi.fn();
    const wake = new SceneEventWake({ ...clock, onWake });
    expect(wake.offer('icqq:g1', group, { sequence: 1, event: ev('member.joined', { member: { id: 'u1' } }), selfIds: [] })).toBe('scheduled');
    await clock.advance(1_000);
    expect(wake.offer('icqq:g1', group, { sequence: 2, event: ev('member.joined', { member: { id: 'u2' } }), selfIds: [] })).toBe('coalesced');
    await clock.advance(2_999);
    expect(onWake).not.toHaveBeenCalled();
    await clock.advance(1);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(onWake.mock.calls[0]![0]).toMatchObject({ key: 'icqq:g1', throughSequence: 2 });
    expect(onWake.mock.calls[0]![0].items).toHaveLength(2);
  });

  it('allows at most one wake per scene per minIntervalMs; later events are deferred, not dropped', async () => {
    const clock = fakeTimers();
    const onWake = vi.fn();
    const onDeferred = vi.fn();
    const wake = new SceneEventWake({ ...clock, onWake, onDeferred, minIntervalMs: 15_000 });
    wake.offer('k', group, { sequence: 1, event: ev('member.joined', { member: { id: 'u1' } }), selfIds: [] });
    await clock.advance(4_000);
    expect(onWake).toHaveBeenCalledTimes(1);
    wake.offer('k', group, { sequence: 2, event: ev('member.left', { member: { id: 'u1' } }), selfIds: [] });
    await clock.advance(4_000);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(onDeferred).toHaveBeenCalledWith('k', 11_000);
    await clock.advance(10_999);
    expect(onWake).toHaveBeenCalledTimes(1);
    await clock.advance(1);
    expect(onWake).toHaveBeenCalledTimes(2);
    expect(onWake.mock.calls[1]![0].throughSequence).toBe(2);
  });

  it('keeps scenes independent and clamps the window to 3–5s', async () => {
    const clock = fakeTimers();
    const onWake = vi.fn();
    const wake = new SceneEventWake({ ...clock, onWake, coalesceMs: 60_000 });
    expect(wake.coalesceMs).toBe(5_000);
    wake.offer('a', group, { sequence: 1, event: ev('member.joined', { member: { id: 'u1' } }), selfIds: [] });
    wake.offer('b', group, { sequence: 2, event: ev('member.joined', { member: { id: 'u2' } }), selfIds: [] });
    await clock.advance(5_000);
    expect(onWake).toHaveBeenCalledTimes(2);
    wake.dispose();
    expect(wake.offer('a', group, { sequence: 3, event: ev('member.joined', { member: { id: 'u3' } }), selfIds: [] })).toBe('disposed');
  });
});

function harness(options: { conversations?: string[]; sessions?: SessionProfileStore } = {}) {
  const clock = fakeTimers();
  const store = new MemoryConversationEventStore();
  const executeTurn = vi.fn(async () => ({ status: 'completed' as const }));
  const deliver = vi.fn(async () => ({ status: 'sent' as const }));
  const ingress = new SceneEventIngress({
    projectRoot: '/tmp/project',
    triggerConfig: () => ({ sceneEvents: { conversations: options.conversations ?? ['icqq:g1'] } }),
    reader: () => store,
    sessions: () => options.sessions,
    deliver,
    executeTurn: executeTurn as never,
    timeoutMs: () => 10_000,
    now: () => Date.now(),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const emit = async (event: ConversationEvent, selfIds: string[] = ['10000']) => {
    const { sequence } = await store.append(event);
    return ingress.handle({ sequence, event, selfIds, endpointId: '10000' });
  };
  return { clock, store, ingress, executeTurn, deliver, emit };
}

describe('SceneEventIngress (wake contract)', () => {
  it('mute-free join: one short turn after debounce, no human message needed, ephemeral lines attached', async () => {
    const { clock, ingress, executeTurn, emit } = harness();
    expect(await emit(ev('message.reaction_changed', { actor: { id: 'u9' }, message: { conversation: group, id: 'm1' }, reaction: '👍', operation: 'added' }))).toBe('low');
    expect(await emit(ev('member.joined', { member: { id: 'u1', displayName: '阿强' } }))).toBe('scheduled');
    expect(executeTurn).not.toHaveBeenCalled();
    await clock.advance(4_000);
    expect(executeTurn).toHaveBeenCalledTimes(1);
    const request = executeTurn.mock.calls[0]![0] as any;
    expect(request.input.text).toBe(SCENE_WAKE_INPUT_TEXT);
    expect(request.input.metadata).toMatchObject({ zhinSceneWake: true, zhinEngagement: 'ambient' });
    // Low-priority reaction did not wake on its own but is visible in the woken turn (newest first).
    expect(request.input.sceneEvents).toEqual(['阿强 joined', 'u9 reacted 👍']);
    expect(request.session.key).toBe('icqq:10000:group:g1');
    expect(request.policy.shell).toBeUndefined();
    expect(request.policy.network).toBeUndefined();
    expect(ingress.lastResult).toMatchObject({ kind: 'woke', status: 'completed' });
  });

  it('poke on the bot wakes; person↔person poke and card changes do not', async () => {
    const { clock, executeTurn, emit } = harness();
    expect(await emit(ev('conversation.poked', { actor: { id: 'u2' }, target: { id: 'u3' } }))).toBe('low');
    expect(await emit(ev('member.card_changed', { member: { id: 'u2' }, value: '新名片' }))).toBe('low');
    await clock.advance(10_000);
    expect(executeTurn).not.toHaveBeenCalled();
    expect(await emit(ev('conversation.poked', { actor: { id: 'u2' }, target: { id: '10000' } }))).toBe('scheduled');
    await clock.advance(4_000);
    expect(executeTurn).toHaveBeenCalledTimes(1);
    expect((executeTurn.mock.calls[0]![0] as any).input.sceneEvents[0]).toBe('u2 poked you');
  });

  it('bot muted: session profile is updated but the model is skipped (session-gate)', async () => {
    const sessions = new SessionProfileStore();
    const { clock, ingress, executeTurn, emit } = harness({ sessions });
    await emit(ev('member.muted', { member: { id: '10000' }, actor: { id: 'admin' }, durationSeconds: 600 }));
    await clock.advance(4_000);
    expect(executeTurn).not.toHaveBeenCalled();
    expect(ingress.lastResult).toEqual({ kind: 'skipped', reason: 'cannot_speak:muted' });
    expect((await sessions.get('icqq', 'group', 'g1'))?.muteUntil).toBeGreaterThan(Date.now());
  });

  it('join request / notice update wake; disabled scenes never wake', async () => {
    const on = harness();
    await on.emit(ev('scene.join_requested', { actor: { id: 'u5' }, comment: '想进群' }));
    await on.emit(ev('scene.notice_updated', { actor: { id: 'u1' }, text: '周五停服维护' }));
    await on.clock.advance(4_000);
    expect(on.executeTurn).toHaveBeenCalledTimes(1);
    expect((on.executeTurn.mock.calls[0]![0] as any).input.sceneEvents).toEqual([
      'notice updated by u1: "周五停服维护"',
      'u5 asks to join: "想进群"',
    ]);
    const off = harness({ conversations: [] });
    expect(await off.emit(ev('member.joined', { member: { id: 'u1' } }))).toBe('disabled');
    await off.clock.advance(10_000);
    expect(off.executeTurn).not.toHaveBeenCalled();
  });

  it('scene lines are shown once per session: the next human turn does not repeat them', async () => {
    const { clock, store, ingress, emit } = harness();
    await emit(ev('member.joined', { member: { id: 'u1' } }));
    await clock.advance(4_000);
    const latest = (await store.append(ev('member.card_changed', { member: { id: 'u1' }, value: 'x' }))).sequence;
    const lines = await ingress.linesFor({ sessionKey: 'icqq:10000:group:g1', conversation: group, platform: 'icqq', throughSequence: latest, selfIds: ['10000'] });
    expect(lines).toEqual(['u1 card → "x"']);
  });
});
