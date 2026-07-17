import type { ProcessInvalidationPlan } from './invalidation-planner.js';

export interface ProcessRestartAdapter {
  restart(plan: ProcessInvalidationPlan): void | Promise<void>;
}

export interface StoppableRoot {
  stop(): Promise<void>;
}

/** Drains one Root lifecycle before handing process replacement to the Host. */
export class RootProcessRestartExecutor {
  #execution?: Promise<void>;

  constructor(
    private readonly root: StoppableRoot,
    private readonly adapter: ProcessRestartAdapter,
  ) {}

  execute(plan: ProcessInvalidationPlan): Promise<void> {
    if (!this.#execution) {
      const request = clonePlan(plan);
      // Keep the completed promise: one process incarnation may request its
      // replacement exactly once, even if several watcher paths converge.
      this.#execution = Promise.resolve().then(async () => {
        await this.root.stop();
        await this.adapter.restart(request);
      });
    }
    return this.#execution;
  }
}

function clonePlan(plan: ProcessInvalidationPlan): ProcessInvalidationPlan {
  return Object.freeze({
    kind: 'process',
    changed: Object.freeze([...plan.changed]),
    reasons: Object.freeze([...plan.reasons]),
  });
}
