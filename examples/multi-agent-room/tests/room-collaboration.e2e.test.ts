/**
 * End-to-end acceptance of the Room core (phase B): three Bots (coordinator / researcher / writer) share one
 * group. A real ImRuntime + a Sandbox-shaped adapter carries the messages; members are scripted (no network,
 * no LLM, no wall clock). Every test builds its own fixture and closes it in `finally`.
 */
import { describe, expect, it } from 'vitest';
import {
  RoomGuardRejectedError,
  RoomSendRateLimitedError,
  RoomTaskAuthorizationError,
  createRoomGuards,
  createRoomSendLimiter,
  createRoomTaskAuthorizer,
  type RoomTaskEvent,
} from '@zhin.js/workroom';
import { defineMiddleware } from 'zhin.js/middleware';
import { ROOM_ID, buildRoomDefinition } from '../src/room.js';
import { createRoomTeam, type RoomTeamOptions, type ScriptedMember } from '../src/team.js';
import { createSandboxImFixture, payloadText, type SandboxImFixture } from './support/sandbox-im.js';

/** Fake clock: `sleep` advances time instead of waiting. */
function createClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; },
    advance: (ms: number) => { t += ms; },
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

type TeamOverrides = Partial<Omit<RoomTeamOptions, 'registry' | 'roomId' | 'outbound' | 'requester' | 'accountOf'>>;

type OutboundRequest = Parameters<SandboxImFixture['im']['send']>[0];

async function setup(options: { room?: ReturnType<typeof buildRoomDefinition>; team?: TeamOverrides } = {}) {
  const fixture = await createSandboxImFixture(options.room ? { room: options.room } : {});
  const clock = createClock();
  // Test switches in front of the shared outbound service (the send chain itself is untouched):
  // `rejectWhen` makes a matching send come back rejected; `holdWhen` blocks a matching send until released.
  const switches: {
    rejectWhen?: (request: OutboundRequest) => boolean;
    holdWhen?: (request: OutboundRequest) => boolean;
    held: ReturnType<typeof deferred<void>>;
    release: ReturnType<typeof deferred<void>>;
  } = { held: deferred(), release: deferred() };
  const outbound: Pick<SandboxImFixture['im'], 'send'> = {
    send: async (request) => {
      if (switches.rejectWhen?.(request)) {
        return { status: 'rejected', failure: { code: 'test_rejected', message: 'rejected by test', retryable: false } } as never;
      }
      if (switches.holdWhen?.(request)) {
        switches.holdWhen = undefined;
        switches.held.resolve();
        await switches.release.promise;
      }
      return fixture.im.send(request);
    },
  };
  const { limiter: limiterOverrides, ...teamOverrides } = options.team ?? {};
  const team = createRoomTeam({
    registry: fixture.registry,
    roomId: ROOM_ID,
    outbound,
    requester: fixture.root,
    accountOf: fixture.accountOf,
    now: clock.now,
    limiter: { now: clock.now, sleep: clock.sleep, ...limiterOverrides },
    ...teamOverrides,
  });
  fixture.setRoute((message) => team.route(message));
  const spoken = () => fixture.sent.map((record) => ({
    from: fixture.nameOf(record.conversation.endpoint.id),
    text: payloadText(record.payload),
    payload: record.payload,
  }));
  const say = (content: string, sender = 'alice') => fixture.deliverAll(undefined, { content, sender });
  const close = async () => { team.dispose(); await fixture.close(); };
  return { ...fixture, team, clock, spoken, say, close, switches };
}

const eventTypes = (events: readonly RoomTaskEvent[]) => events.map((event) => event.type);

describe('Room collaboration (3 Bots, one group)', () => {
  it('routes once, hands off coordinator -> researcher -> writer and completes the Task', async () => {
    const s = await setup();
    try {
      const results = await s.say('帮我写一篇关于 X 的简报');
      expect(results.filter((r) => r.matched)).toHaveLength(1);
      await s.team.idle();

      // B2 dedup + B2b routing: one copy reached the router, on the coordinator's Endpoint, mentioned.
      expect(s.routed).toHaveLength(1);
      expect(s.routed[0]).toMatchObject({ endpointId: s.ids.coordinator, mentioned: true, origin: 'human', sender: 'alice' });

      // Visible projection through the normal send chain (ImRuntime.send -> Endpoint), each Bot speaks as itself.
      const spoken = s.spoken();
      expect(spoken.map((m) => m.from)).toEqual(['coordinator', 'coordinator', 'researcher', 'researcher', 'writer']);
      expect(spoken[0]!.text).toContain('收到');
      expect(spoken[1]!.payload).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'mention', data: expect.objectContaining({ target: s.accounts.researcher }) }),
      ]));
      expect(spoken[3]!.payload).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'mention', data: expect.objectContaining({ target: s.accounts.writer }) }),
      ]));
      expect(spoken[4]!.text).toBe('简报已完成');
      expect(s.sent.every((record) => record.conversation.id === 'team-room' && record.conversation.kind === 'group')).toBe(true);

      // Task state machine
      const task = await s.team.taskService.get(ROOM_ID, 'task-1');
      expect(task).toMatchObject({ status: 'done', assignee: 'writer', handoffCount: 2, result: '最终简报：A、B、C' });
      const events = await s.team.journal.read(ROOM_ID);
      expect(eventTypes(events)).toEqual([
        'task.created', 'task.assigned', 'task.started', 'task.handoff',
        'task.started', 'task.handoff', 'task.started', 'task.completed',
      ]);
      expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(s.team.failures).toEqual([]);
    } finally {
      await s.close();
    }
  });

  it('never treats platform echoes of its own messages as a turn', async () => {
    const s = await setup();
    try {
      await s.say('帮我写一篇关于 X 的简报');
      await s.team.idle();
      const sentBefore = s.sent.length;
      expect(s.routed).toHaveLength(1);

      for (let index = 0; index < sentBefore; index += 1) await s.echo(index);
      await s.team.idle();

      expect(s.routed).toHaveLength(1);
      expect(s.sent).toHaveLength(sentBefore);
      expect(s.team.failures).toEqual([]);
      expect(await s.team.journal.read(ROOM_ID)).toHaveLength(8);
    } finally {
      await s.close();
    }
  });
});

describe('Room guards', () => {
  it('stops at the handoff depth limit, blocks the Task and asks the human', async () => {
    const s = await setup({ team: { maxHandoffDepth: 1 } });
    try {
      await s.say('帮我写一篇关于 X 的简报');
      await s.team.idle();

      const task = await s.team.taskService.get(ROOM_ID, 'task-1');
      expect(task).toMatchObject({ status: 'blocked', assignee: 'researcher', handoffCount: 1 });
      expect(task?.blockedReason).toContain('handoff depth limit');
      const spoken = s.spoken();
      expect(spoken.map((m) => m.from)).toEqual(['coordinator', 'coordinator', 'researcher', 'researcher']);
      const help = spoken[3]!;
      expect(help.text).toMatch(/^@alice 需要你介入/);
      expect(help.payload).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'mention', data: expect.objectContaining({ target: 'alice' }) }),
      ]));
      expect(spoken.some((m) => m.from === 'writer')).toBe(false);
      expect(s.team.failures.map((f) => f.kind)).toEqual(['handoff_refused']);
      expect(eventTypes(await s.team.journal.read(ROOM_ID))).not.toContain('task.completed');
    } finally {
      await s.close();
    }
  });

  it('stops a ping-pong between two members', async () => {
    const bounce: ScriptedMember = () => ({ reply: '信息不够，退回', next: { type: 'handoff', to: 'researcher', note: '再查一下' } });
    const s = await setup({
      room: buildRoomDefinition({ writerHandoffTo: ['researcher'] }),
      team: { maxPingPong: 1, scripts: { writer: bounce } },
    });
    try {
      await s.say('帮我写一篇关于 X 的简报');
      await s.team.idle();

      const task = await s.team.taskService.get(ROOM_ID, 'task-1');
      expect(task).toMatchObject({ status: 'blocked', assignee: 'writer', handoffCount: 2 });
      expect(task?.blockedReason).toContain('ping_pong');
      const spoken = s.spoken();
      expect(spoken.at(-1)).toMatchObject({ from: 'writer' });
      expect(spoken.at(-1)!.text).toMatch(/^@alice 需要你介入/);
      // the researcher was not woken a second time
      expect(spoken.filter((m) => m.from === 'researcher')).toHaveLength(2);
    } finally {
      await s.close();
    }
  });

  it('lets a human interrupt the running turn; only a sensitive account cancels the Task', async () => {
    const release = deferred();
    const started = deferred();
    let sawSignal: AbortSignal | undefined;
    const slowResearcher: ScriptedMember = async ({ signal }) => {
      sawSignal = signal;
      started.resolve();
      await release.promise;
      return { reply: '调研完成（迟到）', next: { type: 'handoff', to: 'writer', note: '调研要点' } };
    };
    const s = await setup({ team: { sensitiveAccounts: ['admin'], scripts: { researcher: slowResearcher } } });
    try {
      await s.say('第一个请求');
      await started.promise;
      await s.say('第二个请求'); // queued behind the running researcher turn
      expect(sawSignal?.aborted).toBe(false);

      // alice: may interrupt the running turn, may not clear the queue nor cancel the Task
      const byAlice = await s.team.cancel('task-1', { accountId: 'alice' });
      expect(byAlice.room).toMatchObject({ cancelledRunning: true, cancelledQueued: 0, queueRefused: true });
      expect(byAlice.taskRefusal).toBeDefined();
      expect(sawSignal?.aborted).toBe(true);
      await expect(s.team.taskService.execute(ROOM_ID, {
        type: 'cancel', commandId: 'forged-cancel', taskId: 'task-1', by: 'human:alice',
      })).rejects.toBeInstanceOf(RoomTaskAuthorizationError);
      expect((await s.team.taskService.get(ROOM_ID, 'task-1'))?.status).toBe('in_progress');

      // admin: clears the queue and cancels the Task
      const byAdmin = await s.team.cancel('task-1', { accountId: 'admin' }, '用户取消');
      expect(byAdmin.room.cancelledQueued).toBe(1);
      expect(byAdmin.task?.status).toBe('cancelled');

      release.resolve();
      await s.team.idle();

      expect((await s.team.taskService.get(ROOM_ID, 'task-1'))?.status).toBe('cancelled');
      expect(eventTypes(await s.team.journal.read(ROOM_ID)).filter((t) => t === 'task.handoff')).toHaveLength(1);
      expect(s.spoken().map((m) => m.from)).toEqual(['coordinator', 'coordinator']); // nothing after the cancel
    } finally {
      release.resolve();
      await s.close();
    }
  });

  it('enforces the role checks of the Task authorizer (journal stays untouched)', async () => {
    const s = await setup();
    try {
      const { taskService, journal } = s.team;
      await taskService.execute(ROOM_ID, {
        type: 'create', commandId: 'c-create', taskId: 'forge', by: 'human:alice', title: '角色检查', assignee: 'coordinator',
      });
      const before = (await journal.read(ROOM_ID)).length;
      expect(before).toBe(2);

      const forged = [
        { type: 'handoff', commandId: 'f1', taskId: 'forge', by: 'writer', to: 'researcher' }, // writer has no handoffTo
        { type: 'handoff', commandId: 'f2', taskId: 'forge', by: 'researcher', to: 'coordinator' }, // not in handoffTo
        { type: 'handoff', commandId: 'f3', taskId: 'forge', by: 'coordinator', to: 'mallory' }, // not a member
        { type: 'start', commandId: 'f4', taskId: 'forge', by: 'mallory' }, // not a member
        { type: 'complete', commandId: 'f5', taskId: 'forge', by: 'human:alice', result: 'x' }, // humans do not work tasks
        { type: 'assign', commandId: 'f6', taskId: 'forge', by: 'researcher', assignee: 'researcher' }, // not coordinator
        { type: 'assign', commandId: 'f7', taskId: 'forge', by: 'human:alice', assignee: 'writer' }, // humans do not assign
        { type: 'create', commandId: 'f8', taskId: 'forge2', by: 'mallory', title: 'x' }, // unknown actor
      ] as const;
      for (const command of forged) {
        await expect(taskService.execute(ROOM_ID, command)).rejects.toBeInstanceOf(RoomTaskAuthorizationError);
      }
      expect(await journal.read(ROOM_ID)).toHaveLength(before);

      // positive control: the coordinator may assign, a legal handoff goes through
      await taskService.execute(ROOM_ID, { type: 'assign', commandId: 'ok1', taskId: 'forge', by: 'coordinator', assignee: 'researcher' });
      expect((await taskService.get(ROOM_ID, 'forge'))?.assignee).toBe('researcher');
    } finally {
      await s.close();
    }
  });

  it('refuses every assign when no role check is supplied (fail-closed default)', async () => {
    const guards = createRoomGuards({});
    const authorizer = createRoomTaskAuthorizer({
      guards,
      actorOf: (by) => ({ origin: 'member', accountId: by }),
    });
    const refusal = authorizer(ROOM_ID, { type: 'assign', commandId: 'a', taskId: 't', by: 'coordinator', assignee: 'researcher', at: 0 });
    expect(refusal).toContain('authorizeAssign');
  });

  it('serializes turns: one Room never runs two turns at once', async () => {
    let running = 0;
    let peak = 0;
    const probe = (inner: ScriptedMember): ScriptedMember => async (turn) => {
      running += 1;
      peak = Math.max(peak, running);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
      running -= 1;
      return inner(turn);
    };
    const defaults = (await import('../src/team.js')).defaultScripts;
    const s = await setup({
      team: {
        scripts: {
          coordinator: probe(defaults.coordinator!),
          researcher: probe(defaults.researcher!),
          writer: probe(defaults.writer!),
        },
      },
    });
    try {
      await Promise.all([s.say('请求一', 'alice'), s.say('请求二', 'bob')]);
      await s.team.idle();
      expect(peak).toBe(1);
      const tasks = await s.team.taskService.list(ROOM_ID);
      expect(tasks.map((t) => t.status)).toEqual(['done', 'done']);
    } finally {
      await s.close();
    }
  });

  it('rejects a turn over the per-minute limit loudly, not silently', async () => {
    const s = await setup({ team: { maxTurnsPerMinute: 1 } });
    try {
      await s.say('帮我写一篇关于 X 的简报');
      await s.team.idle();

      const rejected = s.team.failures.find((f) => f.kind === 'turn_rejected');
      expect(rejected?.error).toBeInstanceOf(RoomGuardRejectedError);
      expect((rejected?.error as RoomGuardRejectedError).code).toBe('turn_rate');
      expect(rejected?.agent).toBe('researcher');
      // the group is told, by the Bot that could not run
      const last = s.spoken().at(-1)!;
      expect(last.from).toBe('researcher');
      expect(last.text).toMatch(/^@alice 需要你介入/);
      expect((await s.team.taskService.get(ROOM_ID, 'task-1'))?.status).toBe('assigned');
    } finally {
      await s.close();
    }
  });
});

describe('Handoff projection failure and mid-speak interrupt', () => {
  it('escalates to the human when the handoff projection is rejected, and the receiver does nothing', async () => {
    let researcherRuns = 0;
    const s = await setup({
      team: { scripts: { researcher: () => { researcherRuns += 1; return { reply: 'should not run' }; } } },
    });
    try {
      // reject only the coordinator's projection of the handoff (a mention of the researcher)
      s.switches.rejectWhen = (request) => {
        const text = payloadText(request.content);
        return s.nameOf(request.conversation.endpoint.id) === 'coordinator' && text.includes(`@${s.accounts.researcher}`);
      };
      await s.say('帮我写一篇关于 X 的简报');
      await s.team.idle();

      const failure = s.team.failures.find((f) => f.kind === 'send_rejected');
      expect(failure).toMatchObject({ agent: 'coordinator', taskId: 'task-1', detail: 'test_rejected' });
      const task = await s.team.taskService.get(ROOM_ID, 'task-1');
      expect(task).toMatchObject({ status: 'blocked', assignee: 'researcher', handoffCount: 1 });
      expect(task?.blockedReason).toContain('handoff projection failed');
      expect(eventTypes(await s.team.journal.read(ROOM_ID))).toEqual([
        'task.created', 'task.assigned', 'task.started', 'task.handoff', 'task.started', 'task.blocked',
      ]);
      const last = s.spoken().at(-1)!;
      expect(last.from).toBe('coordinator');
      expect(last.text).toMatch(/^@alice 需要你介入/);
      expect(researcherRuns).toBe(0);
      expect(s.spoken().some((m) => m.from === 'researcher' || m.from === 'writer')).toBe(false);
    } finally {
      await s.close();
    }
  });

  for (const failing of ['start', 'block'] as const) {
    it(`still asks the human and never runs the receiver when the synthetic ${failing} fails`, async () => {
      let researcherRuns = 0;
      const s = await setup({
        team: {
          scripts: { researcher: () => { researcherRuns += 1; return { reply: 'should not run' }; } },
          extraAuthorize: (_room, command) => (command.type === failing && command.by === 'researcher' ? `${failing} down` : undefined),
        },
      });
      try {
        s.switches.rejectWhen = (request) => {
          const text = payloadText(request.content);
          return s.nameOf(request.conversation.endpoint.id) === 'coordinator' && text.includes(`@${s.accounts.researcher}`);
        };
        await s.say('帮我写一篇关于 X 的简报');
        await s.team.idle();

        expect(s.team.failures.find((f) => f.kind === 'turn_error')).toMatchObject({
          agent: 'researcher', taskId: 'task-1', detail: expect.stringContaining(`${failing} down`),
        });
        const last = s.spoken().at(-1)!;
        expect(last.from).toBe('coordinator');
        expect(last.text).toMatch(/^@alice 需要你介入/);
        expect(last.text).toContain(`${failing} down`);
        expect(researcherRuns).toBe(0);
        expect(s.spoken().some((m) => m.from === 'researcher' || m.from === 'writer')).toBe(false);
      } finally {
        await s.close();
      }
    });
  }

  it('queues nothing for a late Bus / Task event after dispose()', async () => {
    let researcherRuns = 0;
    const s = await setup({
      team: { scripts: { researcher: () => { researcherRuns += 1; return { reply: 'should not run' }; } } },
    });
    try {
      s.team.dispose();
      await s.say('帮我写一篇关于 X 的简报');
      await s.team.idle();
      await s.team.bus.handoff({
        id: 'late-1', room: ROOM_ID, from: 'coordinator', to: 'researcher', text: 'late', taskRef: 'task-1', at: 1,
      });
      await s.team.idle();
      expect(researcherRuns).toBe(0);
    } finally {
      await s.close();
    }
  });

  for (const directive of ['handoff', 'complete'] as const) {
    it(`does not ${directive} when the human interrupts while the reply is being spoken`, async () => {
      let researcherRuns = 0;
      const s = await setup({
        team: {
          scripts: {
            coordinator: () => ({
              reply: '先说一句',
              next: directive === 'handoff'
                ? { type: 'handoff', to: 'researcher', note: '请调研' }
                : { type: 'complete', result: '做完了' },
            }),
            researcher: () => { researcherRuns += 1; return { reply: 'should not run' }; },
          },
        },
      });
      try {
        s.switches.holdWhen = (request) => s.nameOf(request.conversation.endpoint.id) === 'coordinator';
        await s.say('帮我写一篇关于 X 的简报');
        await s.switches.held.promise;
        const cancelled = await s.team.cancel('task-1', { accountId: 'alice' });
        expect(cancelled.room.cancelledRunning).toBe(true);
        s.switches.release.resolve();
        await s.team.idle();

        const types = eventTypes(await s.team.journal.read(ROOM_ID));
        expect(types).not.toContain('task.handoff');
        expect(types).not.toContain('task.completed');
        expect(researcherRuns).toBe(0);
        expect(s.spoken().map((m) => m.from)).toEqual(['coordinator']);
        expect((await s.team.taskService.get(ROOM_ID, 'task-1'))?.status).toBe('in_progress');
      } finally {
        s.switches.release.resolve();
        await s.close();
      }
    });
  }
});

describe('Account-level send limiting', () => {
  it('counts replies and Bus projections of one account on the same limiter', async () => {
    const s = await setup({
      team: { limiter: { minIntervalMs: 0, maxWaitMs: 0, perAccount: { 'researcher-bot': { maxPerMinute: 1 } } } },
    });
    try {
      await s.say('帮我写一篇关于 X 的简报');
      await s.team.idle();

      // researcher: its reply used the only slot, the handoff projection (Bus path, same limiter) was refused
      const bySpeaker = (name: string) => s.spoken().filter((m) => m.from === name);
      expect(bySpeaker('researcher')).toHaveLength(1);
      expect(bySpeaker('coordinator')).toHaveLength(2);
      // the projection is refused, so the chain stops and the Task is blocked; the researcher's Bot is out of
      // slots, so the follow-up ask to the human is refused too (both recorded, nothing thrown)
      expect(s.team.failures.filter((f) => f.kind === 'send_rejected' && f.agent === 'researcher')).toHaveLength(2);
      expect(await s.team.taskService.get(ROOM_ID, 'task-1')).toMatchObject({ status: 'blocked', assignee: 'writer' });
      expect(bySpeaker('writer')).toHaveLength(0);
    } finally {
      await s.close();
    }
  });

  it('accepts outboundMiddleware() as a core middleware and reads the envelope (review round 34)', async () => {
    const clock = createClock();
    const calls: string[] = [];
    const limiter = createRoomSendLimiter({
      now: clock.now,
      sleep: clock.sleep,
      accountOf: (endpointId) => (endpointId === 'ep-1' ? 'account-1' : undefined),
      perAccount: { 'account-1': { maxPerMinute: 1, minIntervalMs: 0 } },
      maxWaitMs: 0,
    });
    // Verification only: a real send path uses EITHER this middleware OR `limiter.send`, never both.
    const definition = defineMiddleware(limiter.outboundMiddleware());
    expect(definition.target).toBe('outbound');

    const context = { input: { conversation: { endpoint: { id: 'ep-1' } } } } as never;
    await definition.handle(context, async () => { calls.push('next'); });
    expect(calls).toEqual(['next']);
    // booked against the account: a second send inside the window is refused (not fail-closed on a missing id)
    await expect(definition.handle(context, async () => { calls.push('again'); }))
      .rejects.toMatchObject({ code: 'room_send_rate_limited' });
    expect(calls).toEqual(['next']);

    // handing over the context instead of the envelope is the documented fail-closed mistake
    const wrong = limiter.middleware({} as never, async () => undefined);
    await expect(wrong).rejects.toBeInstanceOf(RoomSendRateLimitedError);
  });
});
