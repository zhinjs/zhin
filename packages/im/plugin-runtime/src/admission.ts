/**
 * Ingress gate owned by a lifecycle Resource and switched only by SnapshotStore.
 * External callbacks may enter while the owning Resource is present in the
 * committed snapshot; candidate and retired Resources fail closed.
 */
interface AdmissionLifecycle {
  assertClaimable(gate: GenerationAdmissionGate, owner: object): void;
  assertOwner(gate: GenerationAdmissionGate, owner: object): void;
  claim(gate: GenerationAdmissionGate, owner: object): void;
  activate(gate: GenerationAdmissionGate, acquire?: () => () => void): void;
  deactivate(gate: GenerationAdmissionGate): void;
}

// Assigned once by the class static block. The closures are a package-private
// friend seam: lifecycle publication can mutate #private state without adding
// Runtime-only methods to the public gate contract.
let admissionLifecycle: AdmissionLifecycle;

export class GenerationAdmissionGate {
  #state: AdmissionState = { active: false };
  #owner?: object;
  readonly #activationListeners = new Set<() => void>();
  readonly #deactivationListeners = new Set<() => void>();

  static {
    admissionLifecycle = {
      assertClaimable: (gate, owner) => gate.#assertClaimable(owner),
      assertOwner: (gate, owner) => gate.#assertOwner(owner),
      claim: (gate, owner) => { gate.#owner = owner; },
      activate: (gate, acquire) => gate.#activate(acquire),
      deactivate: (gate) => gate.#deactivate(),
    };
  }

  get active(): boolean {
    return this.#state.active;
  }

  acquire(): (() => void) | undefined {
    return this.#state.active ? this.#state.acquire?.() : undefined;
  }

  /** Observe the first commit which publishes this generation. */
  onActivate(listener: () => void): () => void {
    if (this.active) {
      listener();
      return () => undefined;
    }
    this.#activationListeners.add(listener);
    return () => { this.#activationListeners.delete(listener); };
  }

  /**
   * Observe retirement of the generation that owns this gate. The callback is
   * synchronous and must not fail; it is intended for closing process-owned
   * ingress transports such as WebSocket connections.
   */
  onDeactivate(listener: () => void): () => void {
    if (!this.active) {
      listener();
      return () => undefined;
    }
    this.#deactivationListeners.add(listener);
    return () => { this.#deactivationListeners.delete(listener); };
  }

  enter<T>(operation: () => T): T | undefined {
    const release = this.acquire();
    if (!release) return undefined;
    try {
      const result = operation();
      if (isPromiseLike(result)) return Promise.resolve(result).finally(release) as T;
      release();
      return result;
    } catch (error) {
      release();
      throw error;
    }
  }

  #assertClaimable(owner: object): void {
    if (this.#owner && this.#owner !== owner) {
      throw new Error('Generation admission gate belongs to another SnapshotStore');
    }
  }

  #assertOwner(owner: object): void {
    if (this.#owner !== owner) {
      throw new Error('SnapshotStore does not own generation admission gate');
    }
  }

  #activate(acquire?: () => () => void): void {
    this.#state = { active: true, acquire };
    for (const listener of this.#activationListeners) {
      try {
        listener();
      } catch {
        // Admission publication is an infallible pointer switch. Buffered
        // ingress reports through its own dispatch path.
      }
    }
    this.#activationListeners.clear();
  }

  #deactivate(): void {
    this.#state = { active: false };
    for (const listener of this.#deactivationListeners) {
      try {
        listener();
      } catch {
        // Admission publication is an infallible pointer switch. Transport
        // cleanup reports through its own lifecycle and cannot veto commit.
      }
    }
  }
}

interface AdmissionState {
  readonly active: boolean;
  readonly acquire?: () => () => void;
}

export function createGenerationAdmissionGate(): GenerationAdmissionGate {
  return new GenerationAdmissionGate();
}

/** Resource hook used by CapabilityContext to bind an ingress dependency. */
export const generationAdmissionBinder: unique symbol = Symbol('GenerationAdmissionBinder');

export interface GenerationAdmissionBindable<T> {
  /** @internal Runtime lifecycle wiring; never called by plugin authors. */
  [generationAdmissionBinder](gate: GenerationAdmissionGate): T;
}

/** Snapshot value hook used to declare lifecycle-owned ingress gates. */
export const generationAdmissionSource: unique symbol = Symbol('GenerationAdmissionSource');

export interface GenerationAdmissionSource {
  readonly [generationAdmissionSource]: readonly GenerationAdmissionGate[];
}

export function bindGenerationAdmission<T>(value: T, gate: GenerationAdmissionGate): T {
  if (!isObject(value)) return value;
  const binder = (value as Partial<GenerationAdmissionBindable<T>>)[generationAdmissionBinder];
  return typeof binder === 'function' ? binder.call(value, gate) : value;
}

export function collectGenerationAdmissions(
  values: Iterable<unknown>,
): ReadonlySet<GenerationAdmissionGate> {
  const result = new Set<GenerationAdmissionGate>();
  for (const value of values) {
    if (value instanceof GenerationAdmissionGate) {
      result.add(value);
      continue;
    }
    if (!isObject(value)) continue;
    const gates = (value as Partial<GenerationAdmissionSource>)[generationAdmissionSource];
    if (!Array.isArray(gates)) continue;
    for (const gate of gates) {
      if (!(gate instanceof GenerationAdmissionGate)) {
        throw new TypeError('Generation admission source returned an invalid gate');
      }
      result.add(gate);
    }
  }
  return result;
}

export function replaceGenerationAdmissions(
  previous: ReadonlySet<GenerationAdmissionGate>,
  next: ReadonlySet<GenerationAdmissionGate>,
  owner: object,
  acquireNext?: () => () => void,
): void {
  // Validate the complete switch before changing ownership or visibility. A
  // rejected cross-Root gate must leave both generations exactly untouched.
  for (const gate of next) admissionLifecycle.assertClaimable(gate, owner);
  for (const gate of previous) {
    admissionLifecycle.assertOwner(gate, owner);
  }
  for (const gate of next) admissionLifecycle.claim(gate, owner);
  for (const gate of previous) {
    if (next.has(gate)) continue;
    admissionLifecycle.deactivate(gate);
  }
  for (const gate of next) {
    admissionLifecycle.activate(gate, acquireNext);
  }
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function isPromiseLike<T>(value: T): value is T & PromiseLike<unknown> {
  return isObject(value)
    && typeof (value as { readonly then?: unknown }).then === 'function';
}
