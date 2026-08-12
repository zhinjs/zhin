import { createToken, type PluginId, type SnapshotStore } from '@zhin.js/plugin-runtime';
import type { JournalStore } from '@zhin.js/ai/journal-store';
import { PersistentTurnJournal } from '../journal/persistent-turn-journal.js';
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
import { TurnToolRuntime } from '../tool/turn-tool-runtime.js';
import type { TurnToolOutcome } from '../tool/turn-tool-runtime.js';
import type { ToolDescriptor } from '@zhin.js/tool';

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

export const turnJournalStoreToken = createToken<JournalStore>(
  'zhin.agent.turn-journal-store',
  'Durable Agent turn event journal store',
);

export interface ExternalToolCapability extends ToolDescriptor {
  execute(input: Readonly<Record<string, unknown>>, toolUseId: string): Promise<TurnToolOutcome>;
}

/** Canonical fixed-generation execution authority for external tool protocols. */
export class ToolIngressRuntime extends SnapshotAttachedRuntime {
  readonly #ingress = new CapabilityIngress();

  async withTools<TResult>(
    owner: PluginId,
    request: TurnRequest,
    operation: (tools: readonly ExternalToolCapability[]) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    const lease = this.requireSnapshots().acquire();
    let active = true;
    try {
      const capabilities = await this.#ingress.read(lease.value, owner, () => active, request);
      let invocationSequence = 0;
      const tools = Object.freeze(capabilities.tools.map(({ execute: _execute, ...descriptor }) => Object.freeze({
        ...descriptor,
        execute: async (input: Readonly<Record<string, unknown>>, toolUseId: string) => {
          if (!active) throw new Error('External Tool capability scope has ended');
          invocationSequence += 1;
          const invocationRequest: TurnRequest = {
            ...request,
            identity: {
              traceId: request.identity.traceId,
              turnId: `${request.identity.turnId}:${invocationSequence}`,
            },
          };
          const turn = createIngressTurn(lease.value, invocationRequest, capabilities);
          const runtime = new TurnToolRuntime(turn, capabilities.tools);
          const outcome = await runtime.execute(descriptor.name, input, toolUseId);
          await appendExternalToolTerminal(turn, outcome);
          return outcome;
        },
      })));
      return await operation(tools);
    } finally {
      active = false;
      lease.release();
    }
  }
}

async function appendExternalToolTerminal(
  turn: import('../turn/turn-ingress.js').TurnIngress,
  outcome: TurnToolOutcome,
): Promise<void> {
  if (outcome.status === 'completed') {
    await turn.ports.journal.append({
      type: 'turn_end',
      output: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    return;
  }
  if (outcome.status === 'cancelled') {
    await turn.ports.journal.append({
      type: 'turn_cancelled',
      code: 'cancelled',
      reason: outcome.reason,
    });
    return;
  }
  const message = outcome.status === 'failed' ? outcome.error : outcome.reason;
  await turn.ports.journal.append({
    type: 'error',
    error: new Error(message),
    recoverable: false,
  });
}

/** Single Agent execution authority: snapshot + capabilities + terminal algebra. */
export interface AgentTurnExecutionContext {
  readonly turn: import('../turn/turn-ingress.js').TurnIngress;
  readonly capabilities: Omit<AgentCapabilities, 'tools'> & {
    readonly tools: readonly ToolDescriptor[];
  };
  readonly tools: TurnToolRuntime;
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
      const turn = createIngressTurn(lease.value, request, capabilities);
      const catalog = Object.freeze({
        ...capabilities,
        tools: Object.freeze(capabilities.tools.map(({ execute: _execute, ...tool }) => Object.freeze(tool))),
      });
      const tools = new TurnToolRuntime(turn, capabilities.tools);
      return await executeAgentTurn(turn, () => this.run({ turn, capabilities: catalog, tools }), observe);
    } finally {
      active = false;
      lease.release();
    }
  }
}

function createIngressTurn(
  snapshot: import('@zhin.js/plugin-runtime').RuntimeSnapshot,
  request: TurnRequest,
  capabilities: AgentCapabilities,
) {
  return createTurnIngress({
    ...request,
    identity: {
      rootId: String(snapshot.root),
      generation: snapshot.generation,
      traceId: request.identity.traceId,
      turnId: request.identity.turnId,
    },
    capabilities: {
      tools: capabilities.tools.map((tool) => tool.name),
      skills: capabilities.skills.map((skill) => skill.name),
    },
    ports: {
      ...request.ports,
      journal: new PersistentTurnJournal({
        sessionId: request.session.key,
        turnId: request.identity.turnId,
      }, resolveJournalStore(snapshot)),
    },
  });
}

function resolveJournalStore(snapshot: import('@zhin.js/plugin-runtime').RuntimeSnapshot): JournalStore {
  const store = snapshot.resources.get(snapshot.root)?.get(turnJournalStoreToken.id);
  if (!store
    || typeof (store as JournalStore).append !== 'function'
    || typeof (store as JournalStore).replay !== 'function') {
    throw new Error('Agent Turn JournalStore is not installed for this generation');
  }
  return store as JournalStore;
}
