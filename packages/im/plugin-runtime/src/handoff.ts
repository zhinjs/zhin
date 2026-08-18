import { DisposeStack } from './dispose.js';
export interface GenerationHandoff {
  activateNext(signal: AbortSignal): void | Promise<void>;
  deactivateNext(): void | Promise<void>;
}

export interface GenerationHandoffParticipant {
  activateNext?(signal: AbortSignal): void | Promise<void>;
  deactivateNext?(): void | Promise<void>;
}

export interface GenerationHandoffRegistry {
  add(participant: GenerationHandoffParticipant): GenerationHandoffParticipant;
}

/** A transaction failed and its internal compensation also failed. */
export class GenerationCompensationError extends AggregateError {
  constructor(errors: readonly unknown[], message: string, options?: ErrorOptions) {
    super(errors, message, options);
    this.name = 'GenerationCompensationError';
  }
}

/** Composes owner-ordered Resource handoffs and compensates partial progress. */
export class GenerationHandoffStack implements GenerationHandoffRegistry, GenerationHandoff {
  readonly #participants: GenerationHandoffParticipant[] = [];
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

  async activateNext(signal: AbortSignal): Promise<void> {
    this.#assertSealed();
    try {
      for (const participant of this.#participants) {
        if (!participant.activateNext) continue;
        await participant.activateNext(signal);
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
    throw new GenerationCompensationError(
      [primary, rollbackError],
      message,
      { cause: rollbackError },
    );
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
