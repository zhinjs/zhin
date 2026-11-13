import { withoutLoginMedia, type LoginAssist } from '@zhin.js/core';
import type { ConsoleEventHub } from '@zhin.js/host-http';
import { bindLoginAssistStdin } from './login-assist-stdin.js';

interface LoginAssistBinding {
  readonly hub: ConsoleEventHub;
  refs: number;
  readonly dispose: () => void;
}

/**
 * Event / history-safe copy of a legacy login task, matching {@link withoutLoginMedia} for flows:
 * the QR image (`payload.image`) is replaced by `imageOmitted: true`. Consoles read it with
 * `login.list`, which is authorized per Endpoint (the event history is replayed to every subscriber).
 */
export function eventSafeLoginTask<T extends { readonly payload?: Readonly<Record<string, unknown>> }>(task: T): T {
  const payload = task.payload;
  if (!payload || payload.image === undefined) return task;
  const { image: _image, ...rest } = payload;
  return Object.freeze({ ...task, payload: Object.freeze({ ...rest, imageOmitted: true }) });
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

    // Legacy task events enter the hub's replayed history too: no QR image (Consoles read it with
    // `login.list` / `login.flow.get`, which are authorized per Endpoint).
    const unsubPending = assist.subscribe('endpoint.login.pending', task => {
      hub.publish('endpoint.login.pending', eventSafeLoginTask(task));
    });
    const unsubExpired = assist.subscribe('endpoint.login.expired', task => {
      hub.publish('endpoint.login.expired', eventSafeLoginTask(task));
    });
    // ADR 0058: flow snapshots without QR images or sensitive material — the event history keeps
    // them, and Consoles read live material with `login.flow.get`.
    const unsubFlow = assist.subscribe('endpoint.login.flow', flow => {
      try {
        hub.publish('endpoint.login.flow', withoutLoginMedia(flow));
      } catch {
        /* an oversized snapshot must not break the producer; Consoles still poll login.flow.list */
      }
    });
    const unbindStdin = this.#bindStdin(assist);
    const binding: LoginAssistBinding = {
      hub,
      refs: 1,
      dispose: () => {
        unsubPending();
        unsubExpired();
        unsubFlow();
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
