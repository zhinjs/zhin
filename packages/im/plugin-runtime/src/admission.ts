/**
 * Ingress gate owned by a lifecycle Resource and switched only by SnapshotStore.
 * External callbacks may enter while the owning Resource is present in the
 * committed snapshot; candidate and retired Resources fail closed.
 */
export class GenerationAdmissionGate {
  constructor() {
    admissionState.set(this, { active: false });
    admissionDeactivationListeners.set(this, new Set());
  }

  get active(): boolean {
    return admissionState.get(this)?.active === true;
  }

  acquire(): (() => void) | undefined {
    const state = admissionState.get(this);
    return state?.active ? state.acquire?.() : undefined;
  }

  /**
   * Observe retirement of the generation that owns this gate. The callback is
   * synchronous and must not fail; it is intended for closing process-owned
   * ingress transports such as WebSocket connections.
   */
  onDeactivate(listener: () => void): () => void {
    const listeners = admissionDeactivationListeners.get(this);
    if (!listeners) throw new Error('Unknown generation admission gate');
    if (!this.active) {
      listener();
      return () => undefined;
    }
    listeners.add(listener);
    return () => { listeners.delete(listener); };
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
}

interface AdmissionState {
  readonly active: boolean;
  readonly acquire?: () => () => void;
}

const admissionState = new WeakMap<GenerationAdmissionGate, AdmissionState>();
const admissionOwners = new WeakMap<GenerationAdmissionGate, object>();
const admissionDeactivationListeners = new WeakMap<GenerationAdmissionGate, Set<() => void>>();

export function createGenerationAdmissionGate(): GenerationAdmissionGate {
  return new GenerationAdmissionGate();
}

/** Resource hook used by CapabilityContext to bind an ingress dependency. */
export const generationAdmissionBinder: unique symbol = Symbol('GenerationAdmissionBinder');

export interface GenerationAdmissionBindable<T> {
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
  for (const gate of next) assertClaimableAdmission(gate, owner);
  for (const gate of previous) {
    assertAdmissionOwner(gate, owner);
  }
  for (const gate of next) admissionOwners.set(gate, owner);
  for (const gate of previous) {
    if (next.has(gate)) continue;
    admissionState.set(gate, { active: false });
    for (const listener of admissionDeactivationListeners.get(gate) ?? []) {
      try {
        listener();
      } catch {
        // Admission publication is an infallible pointer switch. Transport
        // cleanup reports through its own lifecycle and cannot veto commit.
      }
    }
  }
  for (const gate of next) {
    admissionState.set(gate, { active: true, acquire: acquireNext });
  }
}

function assertClaimableAdmission(gate: GenerationAdmissionGate, owner: object): void {
  const current = admissionOwners.get(gate);
  if (current && current !== owner) {
    throw new Error('Generation admission gate belongs to another SnapshotStore');
  }
}

function assertAdmissionOwner(gate: GenerationAdmissionGate, owner: object): void {
  if (admissionOwners.get(gate) !== owner) {
    throw new Error('SnapshotStore does not own generation admission gate');
  }
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function isPromiseLike<T>(value: T): value is T & PromiseLike<unknown> {
  return isObject(value)
    && typeof (value as { readonly then?: unknown }).then === 'function';
}
