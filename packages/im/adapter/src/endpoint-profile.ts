import {
  SELF_PROFILE_FIELDS,
  EndpointDeliveryError,
  type SelfProfile,
  type SelfProfileField,
  type SelfProfileReadRequest,
  type SelfProfileSnapshot,
  type SelfProfileWriteRequest,
  type SelfProfileWriteResult,
  type SelfProfilePort,
} from '@zhin.js/im-contract';
import { createEndpointOperation } from './endpoint-operation.js';
import { AdapterManagementError } from './adapter-types.js';

export type {
  SelfProfile, SelfProfileField, SelfProfileChange, SelfProfileReadRequest, SelfProfileWriteRequest,
  SelfProfileWriteResult, SelfProfileSnapshot, SelfProfilePort,
} from '@zhin.js/im-contract';
export { SELF_PROFILE_FIELDS } from '@zhin.js/im-contract';

/** Native semantic port. Adapters normalize SDK facts and preserve platform error meaning. */
export interface EndpointProfile {
  readonly writableFields: readonly SelfProfileField[];
  /** Already-observed SDK facts; reading this getter must not initiate network IO. */
  readonly current?: Readonly<SelfProfile>;
  read(request: SelfProfileReadRequest): Promise<Readonly<SelfProfile>>;
  write?(request: SelfProfileWriteRequest): Promise<SelfProfileWriteResult>;
}

/** Configured identity is a fallback, not a request to change a real platform account. */
export interface EndpointProfileConfiguration {
  readonly nickname?: SelfProfile['nickname'];
  readonly profile?: Omit<SelfProfile, 'nickname'>;
}

function profileObject(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdapterManagementError('invalid_configuration', 'profile must be an object');
  return value as Readonly<Record<string, unknown>>;
}

/** @internal Bind current Adapter profile defaults without reintroducing startup transport settings. */
export function mergeEndpointProfileConfiguration(
  defaults: Readonly<Record<string, unknown>>,
  explicit: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const base = profileObject(defaults.profile);
  const override = profileObject(explicit.profile);
  const nickname = explicit.nickname !== undefined ? explicit.nickname : defaults.nickname;
  return {
    ...explicit,
    ...(nickname !== undefined ? { nickname } : {}),
    ...(base || override ? { profile: { ...base, ...override } } : {}),
  };
}

/** Connection defaults retain their existing snapshot semantics; profile overrides remain explicit. */
export function endpointCreationConfiguration(
  defaults: Readonly<Record<string, unknown>>,
  explicit: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const { nickname: _nickname, profile: _profile, ...connectionDefaults } = defaults;
  return { ...connectionDefaults, ...explicit };
}

/** @internal Validate the public configuration once, before constructing profile runtime state. */
export function configuredSelfProfile(config: Readonly<Record<string, unknown>>): Readonly<SelfProfile> {
  const profile = profileObject(config.profile) ?? {};
  for (const field of Object.keys(profile)) {
    if (field === 'nickname' || !SELF_PROFILE_FIELDS.some(known => known === field)) {
      throw new AdapterManagementError('invalid_configuration', `Unsupported configured profile field: ${field}`);
    }
  }
  const input: Readonly<Record<string, unknown>> = {
    ...profile, ...(config.nickname !== undefined ? { nickname: config.nickname } : {}),
  };
  const values: Partial<Record<SelfProfileField, unknown>> = {};
  for (const field of SELF_PROFILE_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (value !== null) {
      if (field === 'age') {
        if (!Number.isSafeInteger(value) || (value as number) < 0) throw new AdapterManagementError('invalid_configuration', 'profile.age must be a non-negative integer');
      } else if (field === 'interests') {
        if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new AdapterManagementError('invalid_configuration', 'profile.interests must be an array of strings');
      } else if (typeof value !== 'string') {
        throw new AdapterManagementError('invalid_configuration', `profile.${field} must be a string`);
      } else if (field === 'gender' && !['male', 'female', 'other', 'unknown'].includes(value)) {
        throw new AdapterManagementError('invalid_configuration', 'profile.gender must be male, female, other or unknown');
      } else if (field === 'avatar' && !isProfileAvatar(value)) {
        throw new AdapterManagementError('invalid_configuration', 'profile.avatar must be an HTTP(S) URL');
      }
    }
    values[field] = value;
  }
  return copyProfile(values as SelfProfile);
}

function isProfileAvatar(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string' || !URL.canParse(value)) return false;
  const protocol = new URL(value).protocol;
  return protocol === 'https:' || protocol === 'http:';
}

/** Copy only public profile fields; raw SDK response keys never escape this domain. */
function copyProfile(profile: Readonly<SelfProfile>): Readonly<SelfProfile> {
  if (!isProfileAvatar(profile.avatar)) throw new TypeError('profile.avatar must be an HTTP(S) URL');
  return Object.freeze(Object.fromEntries(SELF_PROFILE_FIELDS
    .filter(field => profile[field] !== undefined)
    .map(field => [field, field === 'interests' && Array.isArray(profile[field])
      ? Object.freeze([...profile[field]]) : profile[field]])));
}

function sameProfileValue(left: SelfProfile[SelfProfileField], right: SelfProfile[SelfProfileField]): boolean {
  return Object.is(left, right) || (Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => value === right[index]));
}

interface EndpointProfileStateOptions {
  readonly source?: EndpointProfile;
  readonly defaults: Readonly<SelfProfile>;
}

/** @internal One concrete Client's observed facts. No global cache, polling, timer or persistence. */
export class EndpointProfileState implements SelfProfilePort {
  readonly #source?: EndpointProfile;
  readonly #defaults: Readonly<SelfProfile>;
  #observed: Readonly<SelfProfile> = Object.freeze({});
  #loaded = false;
  #revision = 0;
  #readSequence = 0;
  #committedRead = 0;
  #nativeBaseline: Readonly<SelfProfile> = Object.freeze({});
  readonly #nativeVersions = new Map<SelfProfileField, number>();
  #writeTail: Promise<void> = Promise.resolve();

  constructor({ source, defaults }: EndpointProfileStateOptions) {
    this.#source = source;
    this.#defaults = copyProfile(defaults);
    if (!source?.write) Object.defineProperty(this, 'write', { value: undefined });
  }

  peek(): SelfProfileSnapshot {
    this.#observeNative();
    const values = copyProfile({ ...this.#defaults, ...this.#observed });
    const sources = Object.freeze(Object.fromEntries(SELF_PROFILE_FIELDS
      .filter(field => values[field] !== undefined)
      .map(field => [field, this.#observed[field] !== undefined ? 'platform' : 'configured'])));
    return Object.freeze({
      values, sources,
      writableFields: Object.freeze(this.#source?.write ? [...this.#source.writableFields] : []),
      platformStatus: this.#source ? this.#loaded ? 'available' : 'unread' : 'unsupported',
    });
  }

  async read(request: SelfProfileReadRequest): Promise<SelfProfileSnapshot> {
    request.signal.throwIfAborted();
    const source = this.#source;
    if (!source || (this.#loaded && !request.refresh)) return this.peek();
    this.#observeNative();
    const nativeVersions = new Map(this.#nativeVersions);
    const revision = this.#revision;
    const sequence = ++this.#readSequence;
    const profile = await createEndpointOperation(request).prepare(() => source.read(request));
    request.signal.throwIfAborted();
    // A slow earlier read cannot undo a later read or a confirmed write.
    if (revision === this.#revision && sequence >= this.#committedRead) {
      const current = this.#observeNative();
      const observed = { ...this.#observed };
      for (const field of SELF_PROFILE_FIELDS) {
        if (profile[field] === undefined) continue;
        // Native events observed during this query are newer than its response snapshot.
        if (current[field] !== undefined && nativeVersions.get(field) !== this.#nativeVersions.get(field)) continue;
        Object.assign(observed, { [field]: profile[field] });
      }
      // Native reads may only expose a subset. Omission is not evidence that an earlier fact cleared.
      this.#observed = copyProfile(observed);
      this.#loaded = true;
      this.#committedRead = sequence;
    }
    return this.peek();
  }

  async write(request: SelfProfileWriteRequest): Promise<SelfProfileWriteResult> {
    request.signal.throwIfAborted();
    const source = this.#source;
    const write = source?.write;
    if (!write || !source.writableFields.includes(request.change.field)) {
      return { status: 'rejected', message: `This account cannot modify ${request.change.field}` };
    }
    const previous = this.#writeTail;
    let release!: () => void;
    const completed = new Promise<void>(resolve => { release = resolve; });
    this.#writeTail = previous.then(() => completed);
    try {
      // Serialize logical requests; a cancelled waiter has not submitted an effect. An SDK effect
      // already submitted may remain unknown after logical cancellation: no retry or claim about
      // remote completion order is made. Later waiters still remain behind their active predecessor.
      await createEndpointOperation(request).prepare(() => previous);
      return await this.#writeOne({ request, source, write });
    } finally { release(); }
  }

  async #writeOne({ request, source, write }: {
    readonly request: SelfProfileWriteRequest;
    readonly source: EndpointProfile;
    readonly write: NonNullable<EndpointProfile['write']>;
  }): Promise<SelfProfileWriteResult> {
    request.signal.throwIfAborted();
    const nativeBeforeWrite = this.#observeNative();
    let result: SelfProfileWriteResult;
    try {
      result = await createEndpointOperation(request).run(() => write.call(source, request));
      request.signal.throwIfAborted();
    } catch (error) {
      // Unless transport evidence proves no submission, the old value is no longer fresh evidence.
      if (!(error instanceof EndpointDeliveryError) || error.disposition !== 'not_sent') {
        this.#invalidate(request.change.field, nativeBeforeWrite);
      }
      throw error;
    }
    const field = request.change.field;
    // SDKs may return a whole account snapshot for one mutation. Unrelated fields may be stale;
    // only the requested field is evidence confirmed by this operation.
    const confirmed = result.profile?.[field] === undefined ? undefined
      : copyProfile({ [field]: result.profile[field] });
    if (result.status !== 'rejected') {
      const wasLoaded = this.#loaded;
      this.#invalidate(request.change.field, nativeBeforeWrite);
      if (result.status === 'updated') {
        const { change } = request;
        // An upload source is not the account's resulting platform avatar address.
        const changed = change.field === 'avatar' ? {} : { [change.field]: change.value };
        this.#observed = copyProfile({ ...this.#observed, ...changed, ...confirmed });
        this.#loaded = wasLoaded && (change.field !== 'avatar' || confirmed?.avatar !== undefined);
      }
    }
    return Object.freeze({
      status: result.status,
      ...(result.message !== undefined ? { message: result.message } : {}),
      ...(confirmed ? { profile: confirmed } : {}),
    });
  }

  /** Apply only changed native facts: an unchanged SDK login cache cannot undo a newer read/write. */
  #observeNative(): Readonly<SelfProfile> {
    const current = copyProfile(this.#source?.current ?? {});
    const observed = { ...this.#observed };
    for (const field of SELF_PROFILE_FIELDS) {
      if (sameProfileValue(current[field], this.#nativeBaseline[field])) continue;
      this.#nativeVersions.set(field, (this.#nativeVersions.get(field) ?? 0) + 1);
      if (current[field] !== undefined) Object.assign(observed, { [field]: current[field] });
    }
    this.#nativeBaseline = current;
    this.#observed = copyProfile(observed);
    return current;
  }

  #invalidate(field: SelfProfileField, nativeBeforeWrite: Readonly<SelfProfile>): void {
    this.#revision += 1;
    // Compare later native evidence to the pre-submission value, including changes another reader
    // observed while this mutation was pending. Only an unchanged stale cache remains suppressed.
    const baseline = { ...this.#nativeBaseline };
    delete baseline[field];
    if (nativeBeforeWrite[field] !== undefined) Object.assign(baseline, { [field]: nativeBeforeWrite[field] });
    this.#nativeBaseline = copyProfile(baseline);
    const observed = { ...this.#observed };
    delete observed[field];
    this.#observed = copyProfile(observed);
    this.#loaded = false;
  }
}
