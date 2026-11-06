import {
  freezePersonalSessionSelection,
  personalSessionIdentity,
  samePersonalSessionAddress,
  samePersonalSessionOwner,
  PersonalSessionMigrationRequiredError,
  PersonalSessionRepositoryIntegrityError,
  type PersonalSessionIdentity,
  type PersonalSessionRepository,
  type PersonalSessionState,
  type PersonalSessionWriteResult,
} from '../../personal-session/index.js';
import {
  rootPluginId,
  type JsonValue,
  type PersistentStatePort,
  type StateRecord,
  type StateScope,
} from '@zhin.js/plugin-runtime';

const scope: StateScope = Object.freeze({ kind: 'plugin' });
function checked(value: unknown, expected: PersonalSessionIdentity): PersonalSessionState {
  if (!value || typeof value !== 'object') throw new PersonalSessionRepositoryIntegrityError();
  const state = value as PersonalSessionState;
  const identity = personalSessionIdentity(state.identity.address);
  if (
    state.identity.key !== identity.key ||
    state.identity.sceneKey !== identity.sceneKey ||
    !samePersonalSessionOwner(state.identity.owner, identity.owner) ||
    !samePersonalSessionAddress(identity.address, expected.address) ||
    identity.key !== expected.key ||
    identity.sceneKey !== expected.sceneKey ||
    !samePersonalSessionOwner(identity.owner, expected.owner) ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 1
  )
    throw new PersonalSessionRepositoryIntegrityError();
  const selection = freezePersonalSessionSelection(state.selection);
  if (selection.kind === 'profile' && selection.profile.rootId !== identity.address.rootId)
    throw new PersonalSessionRepositoryIntegrityError();
  return Object.freeze({ identity, revision: state.revision, selection });
}
function snapshot(
  record: StateRecord | undefined,
  identity: PersonalSessionIdentity
): PersonalSessionState | undefined {
  if (!record) return undefined;
  const value = record.value as Record<string, unknown>;
  if (
    !value ||
    typeof value !== 'object' ||
    record.expiresAt !== null ||
    value.kind !== 'personal-session'
  )
    throw new PersonalSessionRepositoryIntegrityError();
  if (value.version === 1) throw new PersonalSessionMigrationRequiredError();
  if (value.version !== 2) throw new PersonalSessionRepositoryIntegrityError();
  return checked(value.state, identity);
}

/** Persistent Profile selection only. Legacy catalogs and preset references are never runtime configuration. */
export class InferenceSessionRepository implements PersonalSessionRepository {
  constructor(private readonly state: () => PersistentStatePort | undefined) {}
  #port(): PersistentStatePort {
    const port = this.state();
    if (!port) throw new Error('Personal Session persistence is unavailable');
    return port;
  }
  async read(identity: PersonalSessionIdentity): Promise<PersonalSessionState | undefined> {
    return snapshot(await this.#port().read(rootPluginId(), scope, identity.key), identity);
  }
  async compareAndSet(
    expectedRevision: number,
    value: PersonalSessionState
  ): Promise<PersonalSessionWriteResult> {
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision >= Number.MAX_SAFE_INTEGER
    )
      throw new TypeError('Invalid Session revision');
    const next = checked(value, value.identity);
    if (next.revision !== expectedRevision + 1) throw new PersonalSessionRepositoryIntegrityError();
    const port = this.#port(),
      record = await port.read(rootPluginId(), scope, next.identity.key);
    const current = snapshot(record, next.identity);
    if ((current?.revision ?? 0) !== expectedRevision)
      return { kind: 'conflict', actualRevision: current?.revision ?? 0 };
    const written = await port.compareExchange(
      rootPluginId(),
      scope,
      next.identity.key,
      record?.revision,
      JSON.parse(
        JSON.stringify({ version: 2, kind: 'personal-session', state: next })
      ) as JsonValue,
      null
    );
    if (!written)
      return {
        kind: 'conflict',
        actualRevision:
          snapshot(await port.read(rootPluginId(), scope, next.identity.key), next.identity)
            ?.revision ?? 0,
      };
    return { kind: 'updated', state: next };
  }
}
