import type { ImRuntime } from '@zhin.js/core/runtime';
import type { ConsoleEventHub } from '@zhin.js/host-http';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';
import { publishMessageEvent } from './events.js';
import { InboxMessageRecorder } from './inbox.js';

interface MessageBinding {
  refs: number;
  readonly dispose: () => void;
}

export interface ConsoleMessageBindingsOptions {
  readonly hub: ConsoleEventHub;
  readonly databaseHost?: DatabaseHost;
}

/** Owns the process-level IM message subscription shared by overlapping generations. */
export class ConsoleMessageBindings {
  readonly #bindings = new WeakMap<ImRuntime, MessageBinding>();
  readonly #hub: ConsoleEventHub;
  readonly #databaseHost?: DatabaseHost;

  constructor(options: ConsoleMessageBindingsOptions) {
    this.#hub = options.hub;
    this.#databaseHost = options.databaseHost;
  }

  acquire(im: ImRuntime): () => void {
    const existing = this.#bindings.get(im);
    if (existing) {
      existing.refs += 1;
      return () => this.#release(im, existing);
    }

    const inbox = this.#databaseHost
      ? new InboxMessageRecorder(im, this.#databaseHost)
      : undefined;
    const unsubscribe = im.onMessage((event) => {
      publishMessageEvent(this.#hub, event);
      inbox?.record(event);
    });
    const binding: MessageBinding = { refs: 1, dispose: unsubscribe };
    this.#bindings.set(im, binding);
    return () => this.#release(im, binding);
  }

  #release(im: ImRuntime, binding: MessageBinding): void {
    if (this.#bindings.get(im) !== binding) return;
    binding.refs -= 1;
    if (binding.refs > 0) return;
    this.#bindings.delete(im);
    binding.dispose();
  }
}
