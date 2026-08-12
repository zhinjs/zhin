import type { PluginId, SnapshotStore } from '@zhin.js/plugin-runtime';
import { executeAgentTurn, type TurnEventObserver } from '../turn/execute-agent-turn.js';
import {
  createTurnIngress,
  type TurnOutcome,
  type TurnRequest,
} from '../turn/turn-ingress.js';
import {
  CapabilityIngress,
  type AgentCapabilities,
} from './capability-ingress.js';

abstract class SnapshotAttachedRuntime {
  protected snapshots?: SnapshotStore;

  attach(snapshots: SnapshotStore): void {
    if (this.snapshots && this.snapshots !== snapshots) {
      throw new Error(`${this.constructor.name} is already attached to another Root`);
    }
    this.snapshots = snapshots;
  }

  protected requireSnapshots(): SnapshotStore {
    if (!this.snapshots) throw new Error(`${this.constructor.name} is not attached to a Root`);
    return this.snapshots;
  }
}

/** Read-only fixed-generation capability operations for protocol Hosts. */
export class CapabilityLeaseRuntime extends SnapshotAttachedRuntime {
  readonly #ingress = new CapabilityIngress();

  async withCapabilities<TResult>(
    owner: PluginId,
    operation: (capabilities: AgentCapabilities) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    const lease = this.requireSnapshots().acquire();
    let active = true;
    try {
      return await operation(await this.#ingress.read(
        lease.value,
        owner,
        () => active,
      ));
    } finally {
      active = false;
      lease.release();
    }
  }
}

/** Single Agent execution authority: snapshot + capabilities + terminal algebra. */
export interface AgentTurnExecutionContext {
  readonly turn: import('../turn/turn-ingress.js').TurnIngress;
  readonly capabilities: AgentCapabilities;
}

export type AgentTurnExecutor = (
  context: AgentTurnExecutionContext,
) => AsyncGenerator<import('../event/turn-event.js').TurnEvent, void>;

export class AgentRuntime extends SnapshotAttachedRuntime {
  readonly #ingress = new CapabilityIngress();

  constructor(private readonly run: AgentTurnExecutor) {
    super();
  }

  async execute(
    owner: PluginId,
    request: TurnRequest,
    observe?: TurnEventObserver,
  ): Promise<TurnOutcome> {
    const lease = this.requireSnapshots().acquire();
    let active = true;
    try {
      if (!active) throw new Error('Agent generation operation is not active');
      const capabilities = await this.#ingress.read(lease.value, owner, () => active, request);
      const turn = createTurnIngress({
        ...request,
        identity: {
          rootId: String(lease.value.root),
          generation: lease.value.generation,
          traceId: request.identity.traceId,
          turnId: request.identity.turnId,
        },
        capabilities: {
          tools: capabilities.tools.map((tool) => tool.name),
          skills: capabilities.skills.map((skill) => skill.name),
        },
      });
      return await executeAgentTurn(turn, () => this.run({ turn, capabilities }), observe);
    } finally {
      active = false;
      lease.release();
    }
  }
}
