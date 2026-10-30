import { personalSessionIdentity, samePersonalSessionAddress, samePersonalSessionOwner } from './address.js';
import type { PersonalSessionRepository } from './ports.js';
import type {
  PersonalSessionAccess, PersonalSessionIdentity, PersonalSessionSelection,
  PersonalSessionSelectionCommand, PersonalSessionState,
} from './types.js';

export class PersonalSessionAccessError extends Error {
  constructor() { super('Personal Session belongs to another authenticated owner'); this.name = 'PersonalSessionAccessError'; }
}

export class PersonalSessionRevisionConflictError extends Error {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Personal Session revision conflict: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = 'PersonalSessionRevisionConflictError';
  }
}

export class PersonalSessionRepositoryIntegrityError extends Error {
  constructor() { super('Personal Session repository returned a different address or invalid state'); this.name = 'PersonalSessionRepositoryIntegrityError'; }
}

export function freezePersonalSessionSelection(selection: PersonalSessionSelection): PersonalSessionSelection {
  if (selection.kind === 'inherit') return Object.freeze({ kind: 'inherit' });
  if (selection.kind !== 'preset' || typeof selection.presetId !== 'string' || !selection.presetId.trim()) {
    throw new TypeError('Personal Session selection must inherit or reference a preset');
  }
  return Object.freeze({ kind: 'preset', presetId: selection.presetId });
}

function authorize(access: PersonalSessionAccess): PersonalSessionIdentity {
  const identity = personalSessionIdentity(access.address);
  if (!samePersonalSessionOwner(access.owner, identity.owner)) {
    throw new PersonalSessionAccessError();
  }
  return identity;
}

function checkedState(state: PersonalSessionState, identity: PersonalSessionIdentity): PersonalSessionState {
  if (state.identity.key !== identity.key || state.identity.sceneKey !== identity.sceneKey
    || !samePersonalSessionAddress(state.identity.address, identity.address)
    || !samePersonalSessionOwner(state.identity.owner, identity.owner)
    || !Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw new PersonalSessionRepositoryIntegrityError();
  }
  return Object.freeze({ identity, revision: state.revision, selection: freezePersonalSessionSelection(state.selection) });
}

/** Personal ownership and optimistic concurrency are enforced at this boundary. */
export class PersonalSessionService {
  constructor(private readonly repository: PersonalSessionRepository) {}

  async read(access: PersonalSessionAccess): Promise<PersonalSessionState> {
    const identity = authorize(access);
    const state = await this.repository.read(identity);
    return state ? checkedState(state, identity) : Object.freeze({
      identity, revision: 0, selection: Object.freeze({ kind: 'inherit' as const }),
    });
  }

  async select(command: PersonalSessionSelectionCommand): Promise<PersonalSessionState> {
    const identity = authorize(command);
    const expectedRevision = command.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) {
      throw new TypeError('expectedRevision must be a non-negative safe integer with room for a new revision');
    }
    const next = Object.freeze({
      identity, revision: expectedRevision + 1, selection: freezePersonalSessionSelection(command.selection),
    });
    const result = await this.repository.compareAndSet(expectedRevision, next);
    if (result.kind === 'conflict') {
      throw new PersonalSessionRevisionConflictError(expectedRevision, result.actualRevision);
    }
    const state = checkedState(result.state, identity);
    if (state.revision !== next.revision || JSON.stringify(state.selection) !== JSON.stringify(next.selection)) {
      throw new PersonalSessionRepositoryIntegrityError();
    }
    return state;
  }
}
