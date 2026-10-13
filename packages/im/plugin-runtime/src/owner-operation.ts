import { AsyncLocalStorage } from 'node:async_hooks';
import type { GenerationAdmissionGate } from './admission.js';

interface OperationLease { pending: number; release(): void }
interface OperationFrame { active: boolean; lease: OperationLease }

/** @internal Facade-local leases; detached work loses authority when its frame settles. */
export class OwnerOperation {
  readonly #context = new AsyncLocalStorage<OperationFrame>();
  readonly #gate?: GenerationAdmissionGate;
  readonly #label: string;
  #published = false;
  #setupOpen = true;

  constructor(gate: GenerationAdmissionGate | undefined, label: string) {
    this.#gate = gate;
    this.#label = label;
    gate?.onActivate(() => { this.#published = true; });
  }

  /** Schema/job declarations are permitted in setup before the first publication. */
  setup<T>(operation: () => T): T {
    if (!this.#gate || this.#setupOpen && !this.#published || this.#context.getStore()?.active) return operation();
    const release = this.#gate.acquire();
    if (!release) throw new Error(`${this.#label} operation belongs to an inactive generation`);
    // A query builder may be thenable. Never assimilate it just to check access.
    try { return operation(); }
    finally { release(); }
  }

  endSetup(): void { this.#setupOpen = false; }

  run<T>(operation: () => T): T {
    if (!this.#gate) return operation();
    const parent = this.#context.getStore();
    let lease: OperationLease;
    if (parent?.active) lease = parent.lease;
    else {
      const release = this.#gate.acquire();
      if (!release) throw new Error(`${this.#label} operation belongs to an inactive generation`);
      lease = { pending: 0, release };
    }
    lease.pending++;
    const context = { active: true, lease };
    const finish = () => {
      context.active = false;
      if (--lease.pending === 0) lease.release();
    };
    try {
      const result = this.#context.run(context, operation);
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        return Promise.resolve(result).finally(finish) as T;
      }
      finish();
      return result;
    } catch (error) { finish(); throw error; }
  }
}
