import { runtimeSceneTaskSessionKey } from '../../../../src/plugin-runtime/agent/turn/request.js';
import { describe, expect, it, vi } from 'vitest';
import { MemoryConversationEventStore, type ConversationEvent, type ConversationRef } from '@zhin.js/im-contract';
import { SessionProfileStore, type TurnRequest } from '@zhin.js/agent';
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
    expect(onDeferred).toHaveBeenCalledWith('k', 11_000, group);
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

function harness(options: { conversations?: string[]; sessions?: SessionProfileStore; projectRoot?: string } = {}) {
  const clock = fakeTimers();
  const store = new MemoryConversationEventStore();
  const executeTurn = vi.fn(async (_request: TurnRequest) => ({ status: 'completed' as const }));
  const deliver = vi.fn(async () => ({ status: 'sent' as const }));
  const readConversationContext = vi.fn(async (_conversation: ConversationRef, _consumer: string, _throughSequence: number) => ({ blocks: [], cursor: 0 }));
  const commitConversationContext = vi.fn(async (_conversation: ConversationRef, _consumer: string, _cursor: number) => undefined);
  const onSpoke = vi.fn();
  const ingress = new SceneEventIngress({
    projectRoot: options.projectRoot ?? '/tmp/project',
    readConversationContext,
    commitConversationContext,
    onSpoke,
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
  const emit = async (event: ConversationEvent, selfIds: string[] = ['10000'], endpointId = '10000') => {
    const { sequence } = await store.append(event);
    return ingress.handle({ sequence, event, selfIds, endpointId });
  };
  return { clock, store, ingress, executeTurn, deliver, emit, readConversationContext, commitConversationContext, onSpoke };
}

describe('SceneEventIngress (wake contract)', () => {
  const channel: ConversationRef = { ...group, kind: 'channel', parent: { kind: 'group', id: 'guild-a' }, threadId: 'thread-a' };
  it.each([
    { dimension: 'endpoint instance', first: group, second: group, secondEndpoint: '20000' },
    { dimension: 'canonical endpoint adapter', first: group, second: { ...group, endpoint: { ...endpoint, adapter: 'other-adapter' } } },
    { dimension: 'canonical endpoint id', first: group, second: { ...group, endpoint: { ...endpoint, id: 'root\0slot\0icqq' } } },
    { dimension: 'parent id', first: channel, second: { ...channel, parent: { kind: 'group', id: 'guild-b' } } },
    { dimension: 'parent kind', first: channel, second: { ...channel, parent: { kind: 'channel', id: 'guild-a' } } },
    { dimension: 'thread', first: channel, second: { ...channel, threadId: 'thread-b' } },
  ] satisfies readonly { dimension: string; first: ConversationRef; second: ConversationRef; secondEndpoint?: string }[])(
    'keeps $dimension independent at the real scene-event ingress queue and context cursor', async ({ first, second, secondEndpoint = '10000' }) => {
      const { clock, executeTurn, emit, readConversationContext, commitConversationContext } = harness();
      expect(await emit(ev('member.joined', { conversation: first, member: { id: 'u1' } }))).toBe('scheduled');
      // One identical scene still coalesces; another account/container/thread starts its own window.
      expect(await emit(ev('member.joined', { conversation: first, member: { id: 'u2' } }))).toBe('coalesced');
      expect(await emit(ev('member.joined', { conversation: second, member: { id: 'u3' } }), [secondEndpoint], secondEndpoint)).toBe('scheduled');
      await clock.advance(4_000);
      expect(executeTurn).toHaveBeenCalledTimes(2);
      const requests = executeTurn.mock.calls.map(([request]) => request);
      const expected = [{ conversation: first, endpoint: '10000' }, { conversation: second, endpoint: secondEndpoint }];
      for (const [index, request] of requests.entries()) {
        const { conversation, endpoint: instance } = expected[index]!;
        const key = runtimeSceneTaskSessionKey({ origin: { kind: 'im', platform: 'icqq', endpoint: instance, scope: conversation.kind === 'channel' ? 'channel' : 'group', sceneId: conversation.id, conversation } }, '/tmp/project');
        expect(request.session).toEqual({ key });
        expect(request.origin).toMatchObject({ endpoint: instance, conversation });
        await request.ports.conversationContext!.readPending();
        await request.ports.conversationContext!.commit(index + 1);
        expect(readConversationContext.mock.calls[index]).toEqual([conversation, `agent-session:${key}`, index === 0 ? 2 : 3]);
        expect(commitConversationContext.mock.calls[index]).toEqual([conversation, `agent-session:${key}`, index + 1]);
      }
      expect(requests[0].session.key).not.toBe(requests[1].session.key);
    },
  );

  it('keeps Host roots independent and preserves the existing ambient spoke scene key', async () => {
    const first = harness({ projectRoot: '/tmp/project-a' });
    const second = harness({ projectRoot: '/tmp/project-b' });
    for (const instance of [first, second]) {
      instance.executeTurn.mockImplementationOnce(async (request) => {
        await request.ports.reply.send([]);
        return { status: 'completed' as const };
      });
      await instance.emit(ev('member.joined', { member: { id: 'u1' } }));
      await instance.clock.advance(4_000);
      expect(instance.onSpoke).toHaveBeenCalledExactlyOnceWith('icqq:g1');
    }
    expect(first.executeTurn.mock.calls[0]![0].session.key).not.toBe(second.executeTurn.mock.calls[0]![0].session.key);
  });

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
    expect(request.session.key).toBe(runtimeSceneTaskSessionKey({ origin: { kind: 'im', platform: 'icqq', endpoint: '10000', scope: 'group', sceneId: 'g1', conversation: group } }, '/tmp/project'));
    expect(request.session.personal).toBeUndefined();
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

  it('keeps each personal cursor independent of scene-task consumption', async () => {
    const { clock, store, ingress, emit } = harness();
    await emit(ev('member.joined', { member: { id: 'u1' } }));
    await clock.advance(4_000);
    const latest = (await store.append(ev('member.card_changed', { member: { id: 'u1' }, value: 'x' }))).sequence;
    const lines = await ingress.linesFor({ sessionKey: 'icqq:10000:group:g1', conversation: group, platform: 'icqq', endpointId: '10000', throughSequence: latest, selfIds: ['10000'] });
    expect(lines).toEqual(['u1 card → "x"', 'u1 joined']);
    expect(await ingress.linesFor({ sessionKey: 'icqq:10000:group:g1', conversation: group, platform: 'icqq', endpointId: '10000', throughSequence: latest, selfIds: ['10000'] })).toEqual([]);
  });
});
