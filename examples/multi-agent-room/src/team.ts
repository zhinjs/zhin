/**
 * Room team assembly (example-local, NOT wired into the default runtime; that is C1/C2).
 *
 * Wires the Room core pieces of `@zhin.js/workroom` into one object:
 *
 *   human message -> Room Router (core, picks the member) -> `route()` -> member turn
 *     -> reply through the shared send limiter -> handoff (Task event + Room Bus projection)
 *     -> Bus subscriber wakes the next member after the current turn returns.
 *
 * Invariants:
 * - Every outbound (member replies, handoff projections, escalations) goes through ONE `RoomSendLimiter.send`
 *   in front of the shared `OutboundMessageService`. No other send path exists here.
 * - Collaboration travels over the in-process Room Bus; group messages are only a visible projection.
 * - Guards fail closed; the Task authorizer always carries a role check (`next`).
 */
import {
  MemoryRoomTaskJournal,
  RoomGuardRejectedError,
  RoomTaskAuthorizationError,
  createRoomBus,
  createRoomEventSequencer,
  createRoomGuards,
  createRoomRoleAssignAuthorizer,
  createRoomRoleAuthorizer,
  createRoomSendLimiter,
  createRoomTaskAuthorizer,
  createRoomTaskService,
  type GuardActor,
  type RoomBus,
  type RoomCancelResult,
  type RoomGuards,
  type RoomRegistry,
  type RoomSendLimiter,
  type RoomSendLimiterOptions,
  type RoomTaskAuthorizer,
  type RoomTaskEvent,
  type RoomTaskService,
  type RoomTaskView,
} from '@zhin.js/workroom';
import { defineMiddleware } from 'zhin.js/middleware';
import type { Message, OutboundMessageService } from 'zhin.js/core/runtime';

/**
 * Type-check anchor for the limiter's middleware form. This example compiles under `tsc --noEmit` (its build
 * covers src/ and tests/), so passing `limiter.outboundMiddleware()` to the real `defineMiddleware` here keeps the
 * structural-compatibility check inside the type-checked scope (workroom's own tests are not type-checked).
 * `@zhin.js/workroom` itself imports `defineMiddleware` from `@zhin.js/core/feature/middleware`, not from
 * `zhin.js`, because workroom sits below zhin in the dependency direction.
 */
export function limiterMiddleware(limiter: RoomSendLimiter) {
  return defineMiddleware(limiter.outboundMiddleware());
}

type BusRequester = Parameters<typeof createRoomBus>[0]['requester'];

/** What a scripted member decides after speaking. */
export type MemberDirective =
  | { readonly type: 'handoff'; readonly to: string; readonly note: string }
  | { readonly type: 'complete'; readonly result: string }
  | { readonly type: 'block'; readonly reason: string };

export interface MemberTurnInput {
  readonly agent: string;
  readonly task: RoomTaskView;
  /** The human request (first turn) or the handoff note (later turns). */
  readonly text: string;
  /** Aborted when a human cancels the Room turn. */
  readonly signal: AbortSignal;
}

export interface MemberTurnOutput {
  readonly reply: string;
  readonly next?: MemberDirective;
}

/** Deterministic stand-in for a model-driven member. */
export type ScriptedMember = (turn: MemberTurnInput) => Promise<MemberTurnOutput> | MemberTurnOutput;

/** Default scripts: coordinator -> researcher -> writer -> done. */
export const defaultScripts: Readonly<Record<string, ScriptedMember>> = {
  coordinator: ({ text }) => ({
    reply: `收到，我来拆解：${text}`,
    next: { type: 'handoff', to: 'researcher', note: `请调研：${text}` },
  }),
  researcher: ({ text }) => ({
    reply: `调研完成（${text}）`,
    next: { type: 'handoff', to: 'writer', note: '调研要点：A、B、C，请成稿' },
  }),
  writer: () => ({
    reply: '简报已完成',
    next: { type: 'complete', result: '最终简报：A、B、C' },
  }),
};

export type TeamFailureKind = 'turn_rejected' | 'turn_error' | 'send_rejected' | 'handoff_refused';

export interface TeamFailure {
  readonly kind: TeamFailureKind;
  readonly roomId: string;
  readonly agent?: string;
  readonly taskId?: string;
  readonly error?: unknown;
  readonly detail: string;
}

export interface RoomTeamOptions {
  readonly registry: RoomRegistry;
  readonly roomId: string;
  /** The shared outbound service (`ImRuntime`); the only way anything is sent. */
  readonly outbound: Pick<OutboundMessageService, 'send'>;
  readonly requester: BusRequester;
  readonly accountOf: (endpointId: string) => string | undefined;
  readonly scripts?: Readonly<Record<string, ScriptedMember>>;
  readonly maxHandoffDepth?: number;
  readonly maxPingPong?: number;
  readonly maxTurnsPerMinute?: number;
  readonly sensitiveAccounts?: readonly string[];
  /** Overrides for the account-level send limiter (clock, sleep, per-account limits, ...). */
  readonly limiter?: Omit<RoomSendLimiterOptions, 'inner' | 'accountOf'>;
  /** Extra authorization consulted before the role check (a refusal reason, or undefined to continue). Test seam. */
  readonly extraAuthorize?: RoomTaskAuthorizer;
  readonly now?: () => number;
  readonly logger?: { warn(message: string): void };
}

export interface RoomTeam {
  readonly guards: RoomGuards;
  readonly limiter: RoomSendLimiter;
  readonly bus: RoomBus;
  readonly taskService: RoomTaskService;
  readonly journal: MemoryRoomTaskJournal;
  readonly authorizer: RoomTaskAuthorizer;
  readonly failures: readonly TeamFailure[];
  /** For `ingressRouteToken`: starts a Task for the routed member and returns once the turn is queued. */
  route(message: Message): Promise<boolean>;
  /** Human interrupt: aborts the running turn; cancels the Task only for a sensitive account. */
  cancel(taskId: string, actor: { readonly accountId: string }, reason?: string): Promise<{
    readonly room: RoomCancelResult;
    readonly task?: RoomTaskView;
    /** Set when the Task authorizer refused the cancel. */
    readonly taskRefusal?: string;
  }>;
  /** Resolves when every queued or running turn (including woken ones) has settled. */
  idle(): Promise<void>;
  dispose(): void;
}

const humanActor = (accountId: string): string => `human:${accountId}`;
const humanAccountOf = (by: string): string | undefined => (by.startsWith('human:') ? by.slice('human:'.length) : undefined);

export function createRoomTeam(options: RoomTeamOptions): RoomTeam {
  const { registry, roomId, requester, accountOf, logger } = options;
  const room = registry.room(roomId);
  if (!room) throw new Error(`unknown room ${roomId}`);
  const scripts = { ...defaultScripts, ...options.scripts };
  const now = options.now ?? (() => Date.now());
  const { adapter, kind, id: conversationId } = room.definition.conversation;

  const guards = createRoomGuards({
    now,
    ...(options.maxHandoffDepth !== undefined ? { maxHandoffDepth: options.maxHandoffDepth } : {}),
    ...(options.maxPingPong !== undefined ? { maxPingPong: options.maxPingPong } : {}),
    ...(options.maxTurnsPerMinute !== undefined ? { maxTurnsPerMinute: options.maxTurnsPerMinute } : {}),
    ...(options.sensitiveAccounts !== undefined ? { sensitiveAccounts: options.sensitiveAccounts } : {}),
    ...(logger ? { logger } : {}),
  });

  // ONE limiter instance in the `send` form, in front of the shared outbound service. Member replies, Bus
  // projections and escalations all use it, so one Bot account is counted once. (The middleware form is not
  // layered on top: one path, one form.)
  const limiter = createRoomSendLimiter({ now, ...options.limiter, inner: options.outbound, accountOf });

  // ---- authorization: partial built-ins (cancel / assign) + our role check as `next` (B4-2 invariant)
  const actorOf = (by: string): GuardActor | undefined => {
    const account = humanAccountOf(by);
    if (account !== undefined) return account === '' ? undefined : { origin: 'human', accountId: account };
    return room.memberByAgent(by) ? { origin: 'member' } : undefined;
  };
  const authorizer = createRoomTaskAuthorizer({
    guards,
    actorOf,
    authorizeAssign: createRoomRoleAssignAuthorizer({ room: room.definition, roomId }),
    next: ((roleCheck) => (target, command) => options.extraAuthorize?.(target, command) ?? roleCheck(target, command))(
      createRoomRoleAuthorizer({ room: room.definition, roomId, actorOf }),
    ),
  });

  const journal = new MemoryRoomTaskJournal();
  let commandSeq = 0;
  let taskSeq = 0;
  const nextCommandId = (taskId: string, kindName: string): string => `${taskId}:${kindName}:${++commandSeq}`;
  const taskService = createRoomTaskService({ journal, authorize: authorizer, now, ...(logger ? { logger } : {}) });

  const bus = createRoomBus({ registry, outbound: limiter, requester, accountOf, ...(logger ? { logger } : {}) });

  const failures: TeamFailure[] = [];
  const fail = (failure: TeamFailure): void => {
    failures.push(failure);
    logger?.warn(`room ${failure.roomId} ${failure.kind}${failure.agent ? ` (${failure.agent})` : ''}: ${failure.detail}`);
  };

  /** Speak in the group as `agent`, through the shared limiter (the only send path). */
  const speak = async (agent: string, content: Parameters<RoomSendLimiter['send']>[0]['content'], taskId?: string): Promise<void> => {
    const member = room.memberByAgent(agent);
    if (!member) return;
    const receipt = await limiter.send({
      conversation: { endpoint: { id: member.endpointId, adapter }, kind, id: conversationId },
      requester,
      content,
    });
    if (receipt.status !== 'sent') {
      fail({ kind: 'send_rejected', roomId, agent, ...(taskId ? { taskId } : {}), detail: receipt.failure?.code ?? receipt.status });
    }
  };

  /** Ask the human who started the Task to step in, spoken by `agent`'s own Bot. */
  const askHuman = async (agent: string, task: RoomTaskView | undefined, reason: string): Promise<void> => {
    const account = task ? humanAccountOf(task.createdBy) : undefined;
    const text = ` 需要你介入：${reason}`;
    await speak(agent, account !== undefined
      ? [{ type: 'mention', data: { target: account, name: account } }, { type: 'text', data: { text } }]
      : `@人类${text}`, task?.id);
  };

  // ---- turns
  const inflight = new Set<Promise<unknown>>();
  const track = <T>(promise: Promise<T>): Promise<T> => {
    inflight.add(promise);
    const settle = () => { inflight.delete(promise); };
    promise.then(settle, settle);
    return promise;
  };

  const runMemberTurn = async (agent: string, taskId: string, text: string, signal: AbortSignal, wakeId?: string): Promise<void> => {
    signal.throwIfAborted();
    // A handoff whose projection failed was escalated to the human: the receiver must not run on it.
    if (wakeId !== undefined && discardedHandoffs.has(wakeId)) return;
    let task = await taskService.get(roomId, taskId);
    if (!task || task.assignee !== agent || (task.status !== 'assigned' && task.status !== 'in_progress')) return;
    if (task.status === 'assigned') {
      task = (await taskService.execute(roomId, { type: 'start', commandId: nextCommandId(taskId, 'start'), taskId, by: agent })).state;
    }
    const script = scripts[agent];
    if (!script) throw new Error(`no script for member ${agent}`);
    const output = await script({ agent, task, text, signal });
    // A human cancel while the model was running: nothing is said and nothing is handed off.
    if (signal.aborted) return;
    await speak(agent, output.reply, taskId);
    // A human interrupt while speaking: do not hand off, complete or block.
    if (signal.aborted) return;
    const next = output.next;
    if (!next) return;

    const current = await taskService.get(roomId, taskId);
    if (!current || current.status !== 'in_progress' || current.assignee !== agent) return;

    if (next.type === 'complete') {
      await taskService.execute(roomId, { type: 'complete', commandId: nextCommandId(taskId, 'complete'), taskId, by: agent, result: next.result });
      return;
    }
    if (next.type === 'block') {
      await taskService.execute(roomId, { type: 'block', commandId: nextCommandId(taskId, 'block'), taskId, by: agent, reason: next.reason });
      await askHuman(agent, current, next.reason);
      return;
    }

    // handoff: guard first, then the Task event, then the Bus (projection + wake-up)
    const check = guards.checkHandoff({
      roomId, taskId, from: agent, to: next.to, handoffCount: current.handoffCount, history: await journal.read(roomId),
    });
    if (!check.allowed) {
      await escalate(agent, current, `${check.code}: ${check.reason}`);
      return;
    }
    let handoffEventId: string | undefined;
    try {
      const result = await taskService.execute(roomId, {
        type: 'handoff', commandId: nextCommandId(taskId, 'handoff'), taskId, by: agent, to: next.to, note: next.note,
      });
      handoffEventId = result.events.find((event) => event.type === 'task.handoff')?.eventId;
    } catch (error) {
      if (!(error instanceof RoomTaskAuthorizationError)) throw error;
      await escalate(agent, current, error.reason);
      return;
    }
    if (handoffEventId === undefined) return;
    const delivery = await bus.handoff({
      id: handoffEventId, room: roomId, from: agent, to: next.to, text: next.note, taskRef: taskId, at: now(),
    });
    // The handoff event is already journaled (assignee is next.to). A failed projection means the group never
    // saw the handoff, so stop the chain and ask the human instead of silently continuing.
    if (!delivery.projected) {
      const detail = delivery.projectionError ?? delivery.rejection ?? 'handoff projection failed';
      fail({ kind: 'send_rejected', roomId, agent, taskId, detail });
      await escalateAfterHandoff(agent, next.to, current, detail, handoffEventId);
    }
  };

  /**
   * After a journaled handoff whose projection failed: the pending wake of the receiver is discarded (by handoff
   * event id; a turn already queued checks the same set), the new assignee (status `assigned`) is started and
   * blocked on its behalf (only the assignee may block), then the original speaker ALWAYS asks the human, even
   * when start / block failed. Failures are recorded, never thrown out of the turn.
   */
  const escalateAfterHandoff = async (from: string, to: string, task: RoomTaskView, detail: string, handoffEventId: string): Promise<void> => {
    discardWake(handoffEventId);
    let reason = `handoff projection failed (${detail})`;
    try {
      // The `start` is synthesized only so the receiver can block (the state machine requires in_progress first).
      await taskService.execute(roomId, { type: 'start', commandId: nextCommandId(task.id, 'start'), taskId: task.id, by: to });
      await taskService.execute(roomId, { type: 'block', commandId: nextCommandId(task.id, 'block'), taskId: task.id, by: to, reason });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail({ kind: 'turn_error', roomId, agent: to, taskId: task.id, error, detail: message });
      reason = `${reason}; could not block ${to}'s task: ${message}`;
    }
    try {
      await askHuman(from, task, reason);
    } catch (error) {
      fail({ kind: 'turn_error', roomId, agent: from, taskId: task.id, error, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  /** Stop the chain: block the Task and ask the human. Nobody else is woken. */
  const escalate = async (agent: string, task: RoomTaskView, reason: string): Promise<void> => {
    fail({ kind: 'handoff_refused', roomId, agent, taskId: task.id, detail: reason });
    await taskService.execute(roomId, {
      type: 'block', commandId: nextCommandId(task.id, 'block'), taskId: task.id, by: agent, reason: `handoff refused (${reason})`,
    });
    await askHuman(agent, task, `handoff refused (${reason})`);
  };

  const queueTurn = (agent: string, taskId: string, text: string, wakeId?: string): Promise<void> =>
    track(guards.runExclusive(roomId, (signal) => runMemberTurn(agent, taskId, text, signal, wakeId)).catch(async (error: unknown) => {
      const rejected = error instanceof RoomGuardRejectedError;
      fail({
        kind: rejected ? 'turn_rejected' : 'turn_error', roomId, agent, taskId, error,
        detail: error instanceof Error ? error.message : String(error),
      });
      // Not silent: the member's Bot tells the group. A cancelled turn is a deliberate human action, no notice.
      if (error instanceof RoomGuardRejectedError && error.code === 'cancelled') return;
      const task = await taskService.get(roomId, taskId).catch(() => undefined);
      await askHuman(agent, task, `回合未能执行（${error instanceof Error ? error.message : String(error)}）`).catch(() => undefined);
    }));

  // Task subscribers are dispatched after the Room serial section and may interleave, so every Task event of the
  // Room is fed through a sequencer (ordered, duplicates dropped). A handoff wakes its receiver once it has been
  // released in order AND its Bus event has arrived; either may come first.
  const sequencer = createRoomEventSequencer<RoomTaskEvent>();
  const releasedHandoffs = new Set<string>();
  const pendingWakes = new Map<string, { to: string; taskRef: string; text: string }>();
  const discardedHandoffs = new Set<string>();
  let disposed = false;
  const discardWake = (id: string): void => {
    pendingWakes.delete(id);
    releasedHandoffs.delete(id);
    discardedHandoffs.add(id);
  };
  const wake = (id: string): void => {
    if (disposed || discardedHandoffs.has(id)) return;
    const pending = pendingWakes.get(id);
    if (!pending || !releasedHandoffs.has(id)) return;
    pendingWakes.delete(id);
    releasedHandoffs.delete(id);
    void queueTurn(pending.to, pending.taskRef, pending.text, id);
  };
  const unsubscribeTasks = taskService.subscribe((event) => {
    for (const ready of sequencer.accept(event)) {
      if (ready.type !== 'task.handoff' || disposed || discardedHandoffs.has(ready.eventId)) continue;
      releasedHandoffs.add(ready.eventId);
      wake(ready.eventId);
    }
  });
  // The Bus subscriber only wakes the receiving member. It never awaits the lane: the woken turn is queued
  // behind the running one (awaiting runExclusive of the same Room from inside a turn would deadlock).
  const unsubscribeBus = bus.subscribe((event) => {
    if (event.taskRef === undefined || disposed || discardedHandoffs.has(event.id)) return; // only task.handoff-backed events wake anyone
    pendingWakes.set(event.id, { to: event.to, taskRef: event.taskRef, text: event.text });
    wake(event.id);
  });

  return {
    guards, limiter, bus, taskService, journal, authorizer, failures,

    async route(message: Message): Promise<boolean> {
      // Only a human message starts work; self / member / peer-bot echoes never do.
      if (message.origin !== 'human') return false;
      const target = registry.roomOf(message.conversation);
      if (!target || target.id !== roomId) return false;
      const member = target.memberByEndpoint(String(message.conversation.endpoint.id));
      const sender = message.sender?.id;
      if (!member || typeof sender !== 'string' || sender === '') return false;
      const taskId = `task-${++taskSeq}`;
      const title = message.content.trim().slice(0, 200) || 'untitled request';
      try {
        await taskService.execute(roomId, {
          type: 'create', commandId: nextCommandId(taskId, 'create'), taskId, by: humanActor(sender), title, assignee: member.agent,
        });
      } catch (error) {
        fail({ kind: 'turn_error', roomId, agent: member.agent, taskId, error, detail: error instanceof Error ? error.message : String(error) });
        return false;
      }
      void queueTurn(member.agent, taskId, message.content.trim());
      return true;
    },

    async cancel(taskId, actor, reason) {
      const guardActor: GuardActor = { origin: 'human', accountId: actor.accountId };
      const roomResult = guards.cancelRoom(roomId, guardActor);
      try {
        const result = await taskService.execute(roomId, {
          type: 'cancel', commandId: nextCommandId(taskId, 'cancel'), taskId, by: humanActor(actor.accountId),
          ...(reason !== undefined ? { reason } : {}),
        });
        return { room: roomResult, task: result.state };
      } catch (error) {
        if (error instanceof RoomTaskAuthorizationError) return { room: roomResult, taskRefusal: error.reason };
        throw error;
      }
    },

    async idle() {
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },

    dispose() {
      disposed = true;
      pendingWakes.clear();
      releasedHandoffs.clear();
      discardedHandoffs.clear();
      unsubscribeTasks();
      unsubscribeBus();
    },
  };
}
