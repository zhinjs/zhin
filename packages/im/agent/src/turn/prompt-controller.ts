import { randomUUID } from 'node:crypto';
import type { AgentEvent, AgentMessage, QueueMode } from '@zhin.js/ai';
import type { OnChunkCallback } from '../config/index.js';
import type { AgentLoopTurnResult } from '../core/agent-loop-turn.js';
import type { TurnEvent } from '../event/turn-event.js';
import { SessionMessageQueue } from './session-message-queue.js';
import { TriggerCancelledError } from './trigger-cancelled-error.js';
import type { TurnIntent, TurnPrincipal } from './turn-ingress.js';

export interface PromptTurnHooks {
  getSteeringMessages: () => Promise<AgentMessage[]>;
  getFollowUpMessages: () => Promise<AgentMessage[]>;
}

export interface PromptTurnRequest {
  turnId?: string;
  intent: TurnIntent;
  principal?: TurnPrincipal;
  onAdmitted?: () => void;
  sessionKey: string;
  sessionId: string;
  userMessages: AgentMessage[];
  onChunk?: OnChunkCallback;
  /** Cancels this turn without affecting other sessions or generations. */
  signal?: AbortSignal;
  execute: (
    initialMessages: AgentMessage[],
    hooks: PromptTurnHooks,
    signal: AbortSignal,
    turnId: string,
  ) => Promise<AgentLoopTurnResult>;
}

export interface PromptStreamTurnRequest extends Omit<PromptTurnRequest, 'execute'> {
  execute: (
    initialMessages: AgentMessage[],
    hooks: PromptTurnHooks,
    signal: AbortSignal,
    turnId: string,
  ) => AsyncGenerator<TurnEvent, AgentLoopTurnResult>;
}

/** 同 session 新入站消息取代仍在执行的旧 turn 时抛出；调用方应跳过出站回复。 */
export class TurnSupersededError extends Error {
  readonly sessionKey: string;

  constructor(sessionKey: string) {
    super(`Turn superseded on session ${sessionKey}`);
    this.name = 'TurnSupersededError';
    this.sessionKey = sessionKey;
  }
}

/** A caller cancelled a turn explicitly (for example, an IM trigger timeout). */
export class TurnCancelledError extends Error {
  readonly sessionKey: string;

  constructor(sessionKey: string, reason?: unknown) {
    super(`Turn cancelled on session ${sessionKey}`, reason === undefined ? undefined : { cause: reason });
    this.name = 'TurnCancelledError';
    this.sessionKey = sessionKey;
  }
}

type PromptSubscriber = (event: AgentEvent, signal: AbortSignal) => void | Promise<void>;

interface ActiveTurn {
  turnId: string;
  sessionKey: string;
  queue: SessionMessageQueue;
  abortController: AbortController;
  principal?: TurnPrincipal;
}

export class PromptController {
  private readonly subscribers = new Set<PromptSubscriber>();
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private readonly latestTurnBySession = new Map<string, string>();
  private idleWaiters: Array<() => void> = [];
  private lastResult: AgentLoopTurnResult | null = null;

  constructor(
    private readonly steeringMode: QueueMode,
    private readonly followUpMode: QueueMode,
  ) {}

  isIdle(): boolean {
    return this.activeTurns.size === 0;
  }

  isBusy(): boolean {
    return this.activeTurns.size > 0;
  }

  getActiveTurnCount(): number {
    return this.activeTurns.size;
  }

  getActiveSessionKey(): string | null {
    const latest = [...this.latestTurnBySession.entries()].at(-1);
    return latest?.[0] ?? null;
  }

  getLastResult(): AgentLoopTurnResult | null {
    return this.lastResult;
  }

  subscribe(listener: PromptSubscriber): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  async waitForIdle(): Promise<void> {
    if (this.isIdle()) return;
    await new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  /** Abort all active turns (optionally scoped to one session). */
  abort(sessionKey?: string): void {
    for (const turn of this.activeTurns.values()) {
      if (sessionKey && turn.sessionKey !== sessionKey) continue;
      turn.abortController.abort(new TurnCancelledError(turn.sessionKey));
    }
  }

  /** Cancel the active turn for a session (user-initiated). Returns true if a turn was cancelled. */
  cancelSession(sessionKey: string): boolean {
    const turn = this.resolveLatestTurn(sessionKey);
    if (!turn) return false;
    turn.abortController.abort(new TriggerCancelledError(sessionKey));
    return true;
  }

  clearSteeringQueue(sessionKey?: string): void {
    for (const turn of this.activeTurns.values()) {
      if (sessionKey && turn.sessionKey !== sessionKey) continue;
      turn.queue.clearSteering();
    }
  }

  clearFollowUpQueue(sessionKey?: string): void {
    for (const turn of this.activeTurns.values()) {
      if (sessionKey && turn.sessionKey !== sessionKey) continue;
      turn.queue.clearFollowUp();
    }
  }

  /** Master-only: inject into the latest active turn on this session. */
  steer(sessionKey: string, message: AgentMessage | AgentMessage[]): void {
    const turn = this.resolveLatestTurn(sessionKey);
    if (!turn) {
      throw new Error('steer requires an active turn on the same session');
    }
    turn.queue.pushSteering(message);
  }

  /** Master-only: queue continuation on the latest active turn. */
  followUp(sessionKey: string, message: AgentMessage | AgentMessage[]): void {
    const turn = this.resolveLatestTurn(sessionKey);
    if (!turn) {
      throw new Error('followUp requires an active turn on the same session');
    }
    turn.queue.pushFollowUp(message);
  }

  /** 同 session 串行：新 turn 开始前 abort 仍在执行的旧 turn，避免过期回复污染群上下文。 */
  schedule(request: PromptTurnRequest): Promise<AgentLoopTurnResult> {
    return collectPromptStream(this.scheduleStream({
      ...request,
      execute: (initialMessages, hooks, signal, turnId) => promiseAsPromptStream(
        request.execute(initialMessages, hooks, signal, turnId),
      ),
    }));
  }

  /** Schedule the authoritative TurnEvent stream under the same steering/cancellation lifecycle. */
  scheduleStream(request: PromptStreamTurnRequest): AsyncGenerator<TurnEvent, AgentLoopTurnResult> {
    const intent = request.intent;
    if (intent.kind === 'steer' || intent.kind === 'follow_up') {
      const target = this.resolveIntentTarget(request.sessionKey, intent.targetTurnId);
      if (!target) {
        throw new Error(`${intent.kind} requires an active turn on the same session`);
      }
      if (
        request.principal
        && target.principal
        && request.principal.subjectId !== target.principal.subjectId
        && intent.authorizedBy !== 'product_policy'
      ) {
        throw new Error(`${intent.kind} across principals requires product_policy authorization`);
      }
      if (intent.kind === 'steer') target.queue.pushSteering(request.userMessages);
      else target.queue.pushFollowUp(request.userMessages);
      request.onAdmitted?.();
      return controlTurnStream(intent);
    }
    if (intent.kind === 'observe') {
      request.onAdmitted?.();
      return controlTurnStream(intent);
    }
    if (intent.kind === 'supersede') {
      const targets = [...this.activeTurns.values()]
        .filter((turn) => turn.sessionKey === request.sessionKey);
      if (
        request.principal
        && targets.some((turn) => turn.principal
          && turn.principal.subjectId !== request.principal?.subjectId)
        && intent.authorizedBy !== 'product_policy'
      ) {
        throw new Error('supersede across principals requires product_policy authorization');
      }
      for (const turn of targets) {
        turn.abortController.abort(new TurnSupersededError(request.sessionKey));
      }
    }
    return this.runTurnStream(request);
  }

  private resolveIntentTarget(sessionKey: string, targetTurnId?: string): ActiveTurn | undefined {
    if (targetTurnId) {
      const target = this.activeTurns.get(targetTurnId);
      return target?.sessionKey === sessionKey ? target : undefined;
    }
    return this.resolveLatestTurn(sessionKey);
  }

  private resolveLatestTurn(sessionKey: string): ActiveTurn | undefined {
    const turnId = this.latestTurnBySession.get(sessionKey);
    if (!turnId) return undefined;
    return this.activeTurns.get(turnId);
  }

  private notifyIdle(): void {
    if (!this.isIdle()) return;
    const waiters = this.idleWaiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  }

  private async emitEvent(event: AgentEvent, signal: AbortSignal): Promise<void> {
    for (const listener of this.subscribers) {
      await listener(event, signal);
    }
  }

  private promoteLatestTurn(sessionKey: string, turnId: string): void {
    this.latestTurnBySession.set(sessionKey, turnId);
  }

  private demoteLatestTurn(sessionKey: string, turnId: string): void {
    if (this.latestTurnBySession.get(sessionKey) !== turnId) return;
    this.latestTurnBySession.delete(sessionKey);
    for (const [id, turn] of this.activeTurns) {
      if (turn.sessionKey === sessionKey) {
        this.latestTurnBySession.set(sessionKey, id);
        return;
      }
    }
  }

  private async *runTurnStream(
    request: PromptStreamTurnRequest,
  ): AsyncGenerator<TurnEvent, AgentLoopTurnResult> {
    const turnId = request.turnId ?? randomUUID();
    const abortController = new AbortController();
    const signal = abortController.signal;
    const abortFromCaller = () => {
      abortController.abort(request.signal?.reason ?? new TurnCancelledError(request.sessionKey));
    };
    if (request.signal?.aborted) abortFromCaller();
    else request.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const queue = new SessionMessageQueue(this.steeringMode, this.followUpMode);

    const activeTurn: ActiveTurn = {
      turnId,
      sessionKey: request.sessionKey,
      queue,
      abortController,
      principal: request.principal,
    };
    this.activeTurns.set(turnId, activeTurn);
    this.promoteLatestTurn(request.sessionKey, turnId);
    request.onAdmitted?.();

    let lastResult: AgentLoopTurnResult | null = null;

    try {
      throwIfAborted(signal, request.sessionKey);
      await this.emitEvent({ type: 'agent_start' }, signal);
      throwIfAborted(signal, request.sessionKey);

      const hooks: PromptTurnHooks = {
        getSteeringMessages: async () => queue.drainSteering(),
        getFollowUpMessages: async () => queue.drainFollowUp(),
      };

      try {
        lastResult = yield* request.execute(request.userMessages, hooks, signal, turnId);
      } catch (error) {
        throwIfAborted(signal, request.sessionKey);
        throw error;
      }

      while (queue.hasFollowUp() && !signal.aborted) {
        const batch = queue.drainFollowUp();
        try {
          lastResult = yield* request.execute(batch, hooks, signal, turnId);
        } catch (error) {
          throwIfAborted(signal, request.sessionKey);
          throw error;
        }
      }

      throwIfAborted(signal, request.sessionKey);

      await this.emitEvent({ type: 'agent_end', messages: request.userMessages }, signal);

      if (!lastResult) {
        throw new Error('Prompt turn produced no result');
      }

      this.lastResult = lastResult;
      return lastResult;
    } finally {
      request.signal?.removeEventListener('abort', abortFromCaller);
      this.activeTurns.delete(turnId);
      this.demoteLatestTurn(request.sessionKey, turnId);
      this.notifyIdle();
    }
  }

  dispose(): void {
    for (const turn of this.activeTurns.values()) {
      turn.abortController.abort();
    }
    this.activeTurns.clear();
    this.latestTurnBySession.clear();
    this.subscribers.clear();
    const waiters = this.idleWaiters.splice(0);
    for (const resolve of waiters) resolve();
    this.lastResult = null;
  }
}

async function* controlTurnStream(
  intent: Extract<TurnIntent, { kind: 'steer' | 'follow_up' | 'observe' }> | TurnIntent,
): AsyncGenerator<TurnEvent, AgentLoopTurnResult> {
  yield {
    type: 'turn_end',
    output: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    control: {
      intent: intent.kind as 'steer' | 'follow_up' | 'observe',
      ...(intent.targetTurnId ? { targetTurnId: intent.targetTurnId } : {}),
    },
  };
  return {
    reply: '',
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    path: 'chat',
    iterations: 0,
    model: '',
    toolCalls: [],
  };
}

async function collectPromptStream(
  stream: AsyncGenerator<TurnEvent, AgentLoopTurnResult>,
): Promise<AgentLoopTurnResult> {
  while (true) {
    const step = await stream.next();
    if (step.done) return step.value;
  }
}

async function* promiseAsPromptStream(
  result: Promise<AgentLoopTurnResult>,
): AsyncGenerator<TurnEvent, AgentLoopTurnResult> {
  for (const event of [] as TurnEvent[]) yield event;
  return await result;
}

function throwIfAborted(signal: AbortSignal, sessionKey: string): void {
  if (!signal.aborted) return;
  throw turnAbortReason(sessionKey, signal.reason);
}

function turnAbortReason(sessionKey: string, reason?: unknown): Error {
  // AbortController.abort() without a reason produces DOMException AbortError.
  // Normalize it, but retain deliberate errors such as TriggerTimeoutError.
  if (reason instanceof Error && reason.name !== 'AbortError') return reason;
  return new TurnCancelledError(sessionKey, reason);
}
