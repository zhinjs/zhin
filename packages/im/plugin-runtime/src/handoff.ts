import { DisposeStack } from './dispose.js';
import type { RuntimeSnapshot } from './snapshot.js';

export interface GenerationHandoff {
  quiescePrevious(previous: RuntimeSnapshot): void | Promise<void>;
  activateNext(): void | Promise<void>;
  deactivateNext(): void | Promise<void>;
  resumePrevious(): void | Promise<void>;
  openNext(): void;
}

export interface GenerationHandoffParticipant {
  quiescePrevious?(previous: RuntimeSnapshot): void | Promise<void>;
  activateNext?(): void | Promise<void>;
  deactivateNext?(): void | Promise<void>;
  resumePrevious?(): void | Promise<void>;
  openNext?(): void;
}

export interface GenerationHandoffRegistry {
  add(participant: GenerationHandoffParticipant): GenerationHandoffParticipant;
}

/** Composes owner-ordered Resource handoffs and compensates partial progress. */
export class GenerationHandoffStack implements GenerationHandoffRegistry, GenerationHandoff {
  readonly #participants: GenerationHandoffParticipant[] = [];
  readonly #quiesced: GenerationHandoffParticipant[] = [];
  readonly #activated: GenerationHandoffParticipant[] = [];
  #sealed = false;

  get size(): number {
    return this.#participants.length;
  }

  add(participant: GenerationHandoffParticipant): GenerationHandoffParticipant {
    if (this.#sealed) throw new Error('GenerationHandoffStack is sealed');
    this.#participants.push(participant);
    return participant;
  }

  seal(): GenerationHandoff | undefined {
    this.#sealed = true;
    return this.size > 0 ? this : undefined;
  }

  async quiescePrevious(previous: RuntimeSnapshot): Promise<void> {
    this.#assertSealed();
    try {
      for (const participant of [...this.#participants].reverse()) {
        if (!participant.quiescePrevious) continue;
        await participant.quiescePrevious(previous);
        this.#quiesced.push(participant);
      }
    } catch (error) {
      await compensate(error, () => this.resumePrevious(), 'Quiesce and resume both failed');
    }
  }

  async activateNext(): Promise<void> {
    this.#assertSealed();
    try {
      for (const participant of this.#participants) {
        if (!participant.activateNext) continue;
        await participant.activateNext();
        this.#activated.push(participant);
      }
    } catch (error) {
      await compensate(error, () => this.deactivateNext(), 'Activation and deactivation both failed');
    }
  }

  async deactivateNext(): Promise<void> {
    await unwind(
      this.#activated,
      (participant) => participant.deactivateNext?.(),
      'One or more next-generation Resources failed to deactivate',
    );
  }

  async resumePrevious(): Promise<void> {
    await unwind(
      this.#quiesced,
      (participant) => participant.resumePrevious?.(),
      'One or more previous-generation Resources failed to resume',
    );
  }

  openNext(): void {
    const errors: unknown[] = [];
    for (const participant of this.#participants) {
      try {
        participant.openNext?.();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'One or more Resources failed to open');
  }

  #assertSealed(): void {
    if (!this.#sealed) throw new Error('GenerationHandoffStack is not sealed');
  }
}

async function compensate(
  primary: unknown,
  rollback: () => Promise<void>,
  message: string,
): Promise<never> {
  try {
    await rollback();
  } catch (rollbackError) {
    throw new AggregateError([primary, rollbackError], message, { cause: rollbackError });
  }
  throw primary;
}

async function unwind(
  completed: GenerationHandoffParticipant[],
  run: (participant: GenerationHandoffParticipant) => void | Promise<void>,
  message: string,
): Promise<void> {
  const disposers = new DisposeStack();
  for (const participant of completed.splice(0)) {
    disposers.add(() => run(participant));
  }
  try {
    await disposers.dispose();
  } catch (error) {
    if (error instanceof AggregateError) {
      throw new AggregateError(error.errors, message, { cause: error });
    }
    throw error;
  }
}
