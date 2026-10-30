import {
  AGENT_RUN_EVENT_VERSION,
  type AgentRunEvent,
  type AgentRunEventInput,
  type AgentRunIdentity,
} from '@zhin.js/ai/agent-stream';
import type { JournalStore } from '@zhin.js/ai/journal-store';
import type { TurnEvent } from '../event/turn-event.js';
import { mapTurnEventToAgentStreamEvents } from '../event/turn-to-agent-stream.js';
import type { TurnJournalPort, TurnOrigin } from '../turn/turn-ingress.js';
import { resultResources, type TurnDeliveryStore } from './turn-delivery.js';
import { getLogger } from '@zhin.js/logger';

/** Durable, ordered fact authority for one Turn. */
export class PersistentTurnJournal implements TurnJournalPort {
  readonly #run: AgentRunIdentity;
  readonly #store: JournalStore;
  readonly #principal?: Readonly<{ subjectId: string; displayName?: string; roles: readonly string[] }>;
  #sequence = 0;
  #terminal: AgentRunEvent | undefined;
  #initialized = false;
  #tail: Promise<void> = Promise.resolve();

  constructor(
    run: AgentRunIdentity,
    store: JournalStore,
    principal?: Readonly<{ subjectId: string; displayName?: string; roles: readonly string[] }>,
    private readonly recoveryOrigin?: () => TurnOrigin,
  ) {
    this.#run = Object.freeze({ ...run });
    this.#store = store;
    this.#principal = principal
      ? Object.freeze({ ...principal, roles: Object.freeze([...principal.roles]) })
      : undefined;
  }

  append(event: TurnEvent): Promise<void> {
    const operation = this.#tail.then(
      () => this.#append(event),
      () => this.#append(event),
    );
    this.#tail = operation.catch(() => undefined);
    return operation;
  }

  replay(afterSequence = 0): Promise<readonly AgentRunEvent[]> {
    return this.#store.replay(this.#run, afterSequence);
  }

  get terminal(): AgentRunEvent | undefined {
    return this.#terminal;
  }

  async #append(event: TurnEvent): Promise<void> {
    await this.#initialize();
    if (this.#terminal) throw new Error('Turn Journal is already terminal');
    const mapped = mapTurnEventToAgentStreamEvents(event, {
      sessionId: this.#run.sessionId,
      turnId: this.#run.turnId,
    }) as AgentRunEventInput[];
    const origin = this.recoveryOrigin?.();
    for (const input of mapped) {
      const resources = event.type === 'turn_end' && input.type === 'message.completed'
        && origin?.kind === 'im' && origin.conversation?.endpoint.adapter === 'sandbox'
        ? resultResources(event.output) : undefined;
      const persisted: AgentRunEvent = Object.freeze({
        ...input,
        ...(this.#principal || resources ? {
          data: Object.freeze({
            ...(input.data ?? {}),
            ...(this.#principal ? { principal: this.#principal } : {}),
            ...(resources ? { resources } : {}),
          }),
        } : {}),
        version: AGENT_RUN_EVENT_VERSION,
        run: this.#run,
        sequence: this.#sequence + 1,
        timestamp: input.timestamp ?? Date.now(),
      });
      await this.#store.append(persisted, this.#sequence);
      this.#sequence = persisted.sequence;
      if (persisted.terminal) this.#terminal = persisted;
    }
  }

  async #initialize(): Promise<void> {
    if (this.#initialized) return;
    const existing = await this.#store.replay(this.#run);
    let expected = 1;
    let terminalSeen = false;
    for (const fact of existing) {
      if (fact.run.sessionId !== this.#run.sessionId || fact.run.turnId !== this.#run.turnId) {
        throw new Error('Turn Journal replay returned a fact for another run');
      }
      if (fact.sequence !== expected) {
        throw new Error(`Turn Journal sequence is not contiguous: expected ${expected}, got ${fact.sequence}`);
      }
      if (terminalSeen) throw new Error('Turn Journal contains an event after terminal');
      terminalSeen = Boolean(fact.terminal);
      expected += 1;
    }
    const last = existing.at(-1);
    this.#sequence = last?.sequence ?? 0;
    this.#terminal = last?.terminal ? last : undefined;
    const origin = this.recoveryOrigin?.();
    if (!this.#terminal && this.#principal && origin?.kind === 'im' && origin.conversation?.endpoint.adapter === 'sandbox'
      && typeof (this.#store as Partial<TurnDeliveryStore>).recordRecoveryIdentity === 'function') {
      try {
        await (this.#store as TurnDeliveryStore).recordRecoveryIdentity({ run: this.#run, subjectId: this.#principal.subjectId, origin });
      } catch {
        try { getLogger('AgentJournal').warn('Turn recovery identity could not be persisted'); } catch { /* Diagnostic only. */ }
      }
    }
    this.#initialized = true;
  }
}
