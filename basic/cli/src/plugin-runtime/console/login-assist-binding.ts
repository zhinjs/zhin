import type { LoginAssist } from '@zhin.js/core';
import type { ConsoleEventHub } from '@zhin.js/host-http';
import { bindLoginAssistStdin } from './login-assist-stdin.js';

interface LoginAssistBinding {
  readonly hub: ConsoleEventHub;
  refs: number;
  readonly dispose: () => void;
}

export type LoginAssistStdinBinder = (assist: LoginAssist) => () => void;

export class ConsoleLoginAssistBindings {
  readonly #bindings = new WeakMap<LoginAssist, LoginAssistBinding>();
  readonly #bindStdin: LoginAssistStdinBinder;

  constructor(bindStdin: LoginAssistStdinBinder = bindLoginAssistStdin) {
    this.#bindStdin = bindStdin;
  }

  acquire(assist: LoginAssist, hub: ConsoleEventHub): () => void {
    const existing = this.#bindings.get(assist);
    if (existing) {
      if (existing.hub !== hub) {
        throw new Error('LoginAssist cannot publish to multiple process Console hubs');
      }
      existing.refs += 1;
      return () => this.#release(assist, existing);
    }

    const unsubPending = assist.subscribe('endpoint.login.pending', task => {
      hub.publish('endpoint.login.pending', task);
    });
    const unsubExpired = assist.subscribe('endpoint.login.expired', task => {
      hub.publish('endpoint.login.expired', task);
    });
    const unbindStdin = this.#bindStdin(assist);
    const binding: LoginAssistBinding = {
      hub,
      refs: 1,
      dispose: () => {
        unsubPending();
        unsubExpired();
        unbindStdin();
      },
    };
    this.#bindings.set(assist, binding);
    return () => this.#release(assist, binding);
  }

  #release(assist: LoginAssist, binding: LoginAssistBinding): void {
    if (this.#bindings.get(assist) !== binding) return;
    binding.refs -= 1;
    if (binding.refs > 0) return;
    this.#bindings.delete(assist);
    binding.dispose();
  }
}
