import { randomUUID } from 'node:crypto';
import type { AgentEvent, AgentMessage, QueueMode } from '@zhin.js/ai';
import type { ToolContext } from '../orchestrator/types.js';
import type { OnChunkCallback } from './config.js';
import type { AgentLoopTurnResult } from './agent-loop-turn.js';
import { SessionMessageQueue } from './session-message-queue.js';

export interface PromptTurnHooks {
  getSteeringMessages: () => Promise<AgentMessage[]>;
  getFollowUpMessages: () => Promise<AgentMessage[]>;
}

export interface PromptTurnRequest {
  sessionKey: string;
  sessionId: string;
  userMessages: AgentMessage[];
  context: ToolContext;
  onChunk?: OnChunkCallback;
  execute: (
    initialMessages: AgentMessage[],
    hooks: PromptTurnHooks,
    signal: AbortSignal,
    turnId: string,
  ) => Promise<AgentLoopTurnResult>;
}

type PromptSubscriber = (event: AgentEvent, signal: AbortSignal) => void | Promise<void>;

interface ActiveTurn {
  turnId: string;
  sessionKey: string;
  context: ToolContext;
  queue: SessionMessageQueue;
  abortController: AbortController;
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

  getActiveContext(): ToolContext | null {
    const turnId = [...this.latestTurnBySession.values()].at(-1);
    if (!turnId) return null;
    return this.activeTurns.get(turnId)?.context ?? null;
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
      turn.abortController.abort();
    }
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

  /** Parallel scheduling: each inbound message spawns an independent turn. */
  schedule(request: PromptTurnRequest): Promise<AgentLoopTurnResult> {
    return this.runTurn(request);
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

  private async runTurn(request: PromptTurnRequest): Promise<AgentLoopTurnResult> {
    const turnId = randomUUID();
    const abortController = new AbortController();
    const signal = abortController.signal;
    const queue = new SessionMessageQueue(this.steeringMode, this.followUpMode);

    const activeTurn: ActiveTurn = {
      turnId,
      sessionKey: request.sessionKey,
      context: request.context,
      queue,
      abortController,
    };
    this.activeTurns.set(turnId, activeTurn);
    this.promoteLatestTurn(request.sessionKey, turnId);

    let lastResult: AgentLoopTurnResult | null = null;

    try {
      await this.emitEvent({ type: 'agent_start' }, signal);

      const hooks: PromptTurnHooks = {
        getSteeringMessages: async () => queue.drainSteering(),
        getFollowUpMessages: async () => queue.drainFollowUp(),
      };

      lastResult = await request.execute(request.userMessages, hooks, signal, turnId);

      while (queue.hasFollowUp() && !signal.aborted) {
        const batch = queue.drainFollowUp();
        lastResult = await request.execute(batch, hooks, signal, turnId);
      }

      await this.emitEvent({ type: 'agent_end', messages: request.userMessages }, signal);

      if (!lastResult) {
        throw new Error('Prompt turn produced no result');
      }

      this.lastResult = lastResult;
      return lastResult;
    } finally {
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
