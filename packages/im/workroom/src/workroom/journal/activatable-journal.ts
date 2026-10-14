import type { WorkroomEvent, WorkroomEventDraft } from '../kernel-contracts.js';
import { deepFreezeWorkroomValue as deepFreeze } from '../canonical-value.js';
import type {
  GovernedPayloadPublicationVerification,
  GovernedPayloadWriteSagaSnapshot,
} from '../../data-governance/governed-payload-write-saga.js';
import type { WorkroomJournal, WorkroomStoredRunHeaders } from './contracts.js';

export class ActivatableWorkroomJournal implements WorkroomJournal {
  #delegate: WorkroomJournal | null = null;

  get active(): boolean {
    return this.#delegate !== null;
  }

  activate(delegate: WorkroomJournal): void {
    if (this.#delegate) throw new Error('Workroom journal is already active');
    this.#delegate = delegate;
  }

  listRunIds(): Promise<readonly string[]> {
    return this.#require().listRunIds();
  }

  scanStoredHeaders(): Promise<readonly WorkroomStoredRunHeaders[]> {
    return this.#require().scanStoredHeaders();
  }

  readStoredHeaders(runId: string): Promise<WorkroomStoredRunHeaders | null> {
    return this.#require().readStoredHeaders(runId);
  }

  verifyGovernedPayloadPublication(
    intent: GovernedPayloadWriteSagaSnapshot,
  ): Promise<GovernedPayloadPublicationVerification> {
    const delegate = this.#require();
    return delegate.verifyGovernedPayloadPublication
      ? delegate.verifyGovernedPayloadPublication(intent)
      : Promise.resolve(deepFreeze({ status: 'unknown' as const }));
  }

  read(runId: string): Promise<readonly WorkroomEvent[]> {
    return this.#require().read(runId);
  }

  append(runId: string, expectedSequence: number, events: readonly WorkroomEventDraft[]): Promise<readonly WorkroomEvent[]> {
    return this.#require().append(runId, expectedSequence, events);
  }

  #require(): WorkroomJournal {
    if (!this.#delegate) throw new Error('Workroom journal is not active');
    return this.#delegate;
  }
}
