import type { PluginId, SnapshotStore } from '@zhin.js/plugin-runtime';
import type { Message } from '@zhin.js/core';
import {
  CapabilityIngress,
  type AgentCapabilities,
} from './capability-ingress.js';

export class AgentRuntime {
  readonly #ingress = new CapabilityIngress();
  #snapshots?: SnapshotStore;

  attach(snapshots: SnapshotStore): void {
    if (this.#snapshots && this.#snapshots !== snapshots) {
      throw new Error('AgentRuntime is already attached to another Root');
    }
    this.#snapshots = snapshots;
  }

  async runTurn<TResult>(
    owner: PluginId,
    operation: (capabilities: AgentCapabilities) => TResult | Promise<TResult>,
    options?: { readonly message?: Message },
  ): Promise<TResult> {
    if (!this.#snapshots) throw new Error('AgentRuntime is not attached to a Root');
    const lease = this.#snapshots.acquire();
    let active = true;
    try {
      return await operation(this.#ingress.read(
        lease.value,
        owner,
        () => active,
        options?.message,
      ));
    } finally {
      active = false;
      lease.release();
    }
  }
}
