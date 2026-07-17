import type { Dispose } from './dispose.js';

export interface LifetimeLease {
  release(): Promise<void>;
}

export class SharedLifetime {
  #references = 0;
  #closed = false;
  #disposal?: Promise<void>;

  constructor(private readonly dispose: Dispose) {}

  get references(): number {
    return this.#references;
  }

  acquire(): LifetimeLease {
    if (this.#closed) throw new Error('SharedLifetime is closed');
    this.#references += 1;
    let released = false;
    return {
      release: async () => {
        if (released) return this.#disposal;
        released = true;
        this.#references -= 1;
        if (this.#references === 0) {
          this.#closed = true;
          this.#disposal = Promise.resolve().then(this.dispose);
        }
        await this.#disposal;
      },
    };
  }
}
