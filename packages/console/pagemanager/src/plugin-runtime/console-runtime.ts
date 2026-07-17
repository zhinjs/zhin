import type { SnapshotStore } from '@zhin.js/plugin-runtime';
import type { AccessSnapshot } from '@zhin.js/console-contract';
import { ConsoleCatalog } from './console-catalog.js';

export class ConsoleRuntime {
  #snapshots?: SnapshotStore;

  attach(snapshots: SnapshotStore): void {
    if (this.#snapshots && this.#snapshots !== snapshots) {
      throw new Error('ConsoleRuntime is already attached to another Root');
    }
    this.#snapshots = snapshots;
  }

  async runView<TResult>(
    access: AccessSnapshot,
    operation: (catalog: ConsoleCatalog) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    if (!this.#snapshots) throw new Error('ConsoleRuntime is not attached to a Root');
    const lease = this.#snapshots.acquire();
    let active = true;
    try {
      return await operation(new ConsoleCatalog(lease.value, access, () => active));
    } finally {
      active = false;
      lease.release();
    }
  }
}
