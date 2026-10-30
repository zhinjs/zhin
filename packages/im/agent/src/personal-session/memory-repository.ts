import { personalSessionIdentity, samePersonalSessionAddress, samePersonalSessionOwner } from './address.js';
import type { PersonalSessionRepository, PersonalSessionWriteResult } from './ports.js';
import { freezePersonalSessionSelection, PersonalSessionRepositoryIntegrityError } from './service.js';
import type { PersonalSessionIdentity, PersonalSessionState } from './types.js';

/** Process-local adapter. Production persistence is supplied by the composition root. */
export class MemoryPersonalSessionRepository implements PersonalSessionRepository {
  private readonly states = new Map<string, PersonalSessionState>();

  async read(identity: PersonalSessionIdentity): Promise<PersonalSessionState | undefined> {
    const state = this.states.get(identity.key);
    if (state && !samePersonalSessionAddress(state.identity.address, identity.address)) {
      throw new PersonalSessionRepositoryIntegrityError();
    }
    return state;
  }

  async compareAndSet(expectedRevision: number, next: PersonalSessionState): Promise<PersonalSessionWriteResult> {
    const identity = personalSessionIdentity(next.identity.address);
    if (identity.key !== next.identity.key || identity.sceneKey !== next.identity.sceneKey
      || !samePersonalSessionOwner(identity.owner, next.identity.owner)
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || next.revision !== expectedRevision + 1) {
      throw new PersonalSessionRepositoryIntegrityError();
    }
    // No await between comparison and write: one synchronous critical section.
    const previous = this.states.get(identity.key);
    if (previous && !samePersonalSessionAddress(previous.identity.address, identity.address)) {
      throw new PersonalSessionRepositoryIntegrityError();
    }
    const actualRevision = previous?.revision ?? 0;
    if (actualRevision !== expectedRevision) return Object.freeze({ kind: 'conflict', actualRevision });
    const state = Object.freeze({ identity, revision: next.revision, selection: freezePersonalSessionSelection(next.selection) });
    this.states.set(identity.key, state);
    return Object.freeze({ kind: 'updated', state });
  }
}
