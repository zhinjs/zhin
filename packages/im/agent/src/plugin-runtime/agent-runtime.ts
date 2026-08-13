import { createToken, type PluginId, type SnapshotLease, type SnapshotStore } from '@zhin.js/plugin-runtime';
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
  type ToolCapability,
} from './capability-ingress.js';
import { TurnToolRuntime, type TurnToolOutcome } from '../tool/turn-tool-runtime.js';
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
  /** Executable descriptors bound to the same active generation lease. */
  readonly toolCapabilities: readonly ToolCapability[];
  readonly selection: AgentCapabilitySelection;
}

/** Root-owned serialization authority shared by every Agent generation. */
export class AgentTurnCoordinator {
  readonly #tails = new Map<string, Promise<void>>();

  async run<TResult>(
    sessionKey: string,
    signal: AbortSignal,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const previous = this.#tails.get(sessionKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    this.#tails.set(sessionKey, tail);
    try {
      await waitForTurn(previous.catch(() => undefined), signal);
      return await operation();
    } finally {
      release();
      if (this.#tails.get(sessionKey) === tail) this.#tails.delete(sessionKey);
    }
  }
}

export type AgentTurnExecutor = (
  context: AgentTurnExecutionContext,
) => AsyncGenerator<import('../event/turn-event.js').TurnEvent, void>;

/** Generation-owned complete Turn engine resolved from the held snapshot. */
export interface AgentTurnEngine {
  run: AgentTurnExecutor;
}

export const agentTurnEngineToken = createToken<AgentTurnEngine>(
  'zhin.agent.turn-engine',
  'Complete Agent Turn engine owned by one Root generation',
);

export interface AgentRuntimeOptions {
  /** Root-owned queue shared by every AgentRuntime generation of that Root. */
  readonly coordinator: AgentTurnCoordinator;
}

export interface AgentCapabilitySelection {
  /** Binding-local MCP names. Empty means no MCP capability is exposed. */
  readonly mcpServers: readonly string[];
  /** Optional owner-visible specialist selected by the ingress router. */
  readonly agent?: string;
}

export class AgentRuntime extends SnapshotAttachedRuntime {
  readonly #ingress = new CapabilityIngress();

  constructor(private readonly options: AgentRuntimeOptions) {
    super();
  }

  async execute(
    owner: PluginId,
    request: TurnRequest,
    selection: AgentCapabilitySelection,
    observe?: TurnEventObserver,
  ): Promise<TurnOutcome> {
    const lease = this.requireSnapshots().acquire();
    try {
      return await this.executeLeased(lease, owner, request, selection, observe);
    } finally {
      lease.release();
    }
  }

  /** Executes under the fixed-generation lease owned by the ingress operation. */
  async executeLeased(
    lease: SnapshotLease,
    owner: PluginId,
    request: TurnRequest,
    selection: AgentCapabilitySelection,
    observe?: TurnEventObserver,
  ): Promise<TurnOutcome> {
    const snapshots = this.requireSnapshots();
    if (!snapshots.owns(lease)) throw new Error('AgentRuntime rejected a lease owned by another Root');
    if (!lease.active) throw new Error('AgentRuntime requires an active generation lease');
    return this.options.coordinator.run(request.session.key, request.signal, () =>
      this.#executeLeased(lease, owner, request, selection, observe));
  }

  async #executeLeased(
    lease: SnapshotLease,
    owner: PluginId,
    request: TurnRequest,
    selection: AgentCapabilitySelection,
    observe?: TurnEventObserver,
  ): Promise<TurnOutcome> {
    let active = true;
    try {
      if (!active) throw new Error('Agent generation operation is not active');
      const discovered = await this.#ingress.read(lease.value, owner, () => active && lease.active, request);
      const capabilities = Object.freeze({
        ...discovered,
        tools: Object.freeze([
          ...discovered.tools,
          ...await expandMcpTools(discovered, selection.mcpServers),
        ]),
      });
      const turn = createIngressTurn(lease.value, request, capabilities);
      const catalog = Object.freeze({
        ...capabilities,
        tools: Object.freeze(capabilities.tools.map(({ execute: _execute, ...tool }) => Object.freeze(tool))),
      });
      const tools = new TurnToolRuntime(turn, capabilities.tools);
      const engine = resolveTurnEngine(lease.value);
      return await executeAgentTurn(turn, () => engine.run({
        turn,
        capabilities: catalog,
        tools,
        toolCapabilities: capabilities.tools,
        selection,
      }), observe);
    } finally {
      active = false;
    }
  }
}

function resolveTurnEngine(snapshot: import('@zhin.js/plugin-runtime').RuntimeSnapshot): AgentTurnEngine {
  const candidate = snapshot.resources.get(snapshot.root)?.get(agentTurnEngineToken.id);
  if (!candidate || typeof (candidate as AgentTurnEngine).run !== 'function') {
    throw new Error('Active generation does not provide an Agent Turn Engine');
  }
  return candidate as AgentTurnEngine;
}

async function waitForTurn(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason ?? new Error('Agent turn cancelled while queued');
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(signal.reason ?? new Error('Agent turn cancelled while queued'));
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    await Promise.race([previous, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export async function expandMcpTools(
  capabilities: AgentCapabilities,
  allowedServers: readonly string[],
): Promise<ToolCapability[]> {
  const expanded: ToolCapability[] = [];
  const occupied = new Set(capabilities.tools.map((tool) => tool.name));
  for (const connection of capabilities.mcp) {
    if (!allowedServers.includes(connection.name)) continue;
    for (const tool of await connection.listTools()) {
      const name = `${connection.qualifiedName}__${tool.name}`;
      if (occupied.has(name)) {
        throw new Error(`Duplicate Agent Tool capability: ${name}`);
      }
      occupied.add(name);
      expanded.push(Object.freeze({
        owner: connection.owner,
        name,
        qualifiedName: name,
        description: tool.description?.trim() || `${connection.name} MCP tool ${tool.name}`,
        inputSchema: tool.inputSchema,
        approval: 'on-risk' as const,
        source: connection.source,
        execute: <TInput = unknown, TResult = unknown>(input: TInput) =>
          connection.callTool<TResult>(tool.name, input),
      }));
    }
  }
  return expanded;
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
