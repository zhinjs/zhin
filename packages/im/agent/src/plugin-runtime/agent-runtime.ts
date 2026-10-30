import type { TurnEvent } from '../event/turn-event.js';
import { hostProtectedPathsToken, type HostProtectedPaths } from '../security/host-config-paths.js';
import { AgentUsageCollector, agentUsageStoreToken, type AgentUsageStore } from '../usage/usage-store.js';
import { getLogger } from '@zhin.js/logger';
import { logTurnUsage, type UsageLogContext } from '../trace/turn-usage-log.js';
import { createToken, type PluginId, type SnapshotLease, type SnapshotReader } from '@zhin.js/plugin-runtime';
import { applyTurnTrust } from '../security/trust-level.js';
import type { JournalStore } from '@zhin.js/ai/journal-store';
import { PersistentTurnJournal } from '../journal/persistent-turn-journal.js';
import { TurnTraceCollector } from '../trace/turn-trace.js';
import { createTracingJournal, registerTurnTrace } from '../trace/turn-trace-registry.js';
import { createJournalFeed } from '../turn/journal-feed.js';
import type { TurnTraceStore } from '../trace/turn-trace-store.js';
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
import { requireToolInputSchema, type ToolDescriptor, type ToolInvocationContext } from '@zhin.js/tool';
import type { ResolvedAgentBinding } from '../config/types.js';
import { runWithAgentTurnConfiguration } from '../turn/agent-turn-context.js';
import { TurnSupersededError } from '../turn/prompt-controller.js';
import { createConversationReferenceCapability } from '../tool/conversation-reference-tool.js';
import { drainAgentTurnDecisionObservations, runWithAgentDecisionTurn } from './decision-runtime.js';
import type { AgentDecisionRuntime } from '../decision/types.js';

abstract class SnapshotAttachedRuntime {
  protected snapshots?: SnapshotReader;

  attach(snapshots: SnapshotReader): void {
    if (this.snapshots && this.snapshots !== snapshots) {
      throw new Error(`${this.constructor.name} is already attached to another Root`);
    }
    this.snapshots = snapshots;
  }

  protected requireSnapshots(): SnapshotReader {
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
      const tools = Object.freeze(capabilities.tools
        .filter((tool) => !tool.hidden)
        .map(({ execute: _execute, ...descriptor }) => Object.freeze({
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
  readonly decision?: AgentDecisionRuntime;
  readonly turn: import('../turn/turn-ingress.js').TurnIngress;
  readonly capabilities: Omit<AgentCapabilities, 'tools'> & {
    readonly tools: readonly ToolDescriptor[];
  };
  readonly tools: TurnToolRuntime;
  /** Executable descriptors bound to the same active generation lease. */
  readonly toolCapabilities: readonly ToolCapability[];
  readonly selection: AgentCapabilitySelection;
  /** Signals that this ingress has reached the ordered PromptController boundary. */
  readonly admit?: () => void;
}

/** Root-owned serialization authority shared by every Agent generation. */
export class AgentTurnCoordinator {
  readonly #tails = new Map<string, Promise<void>>();
  readonly #admissions = new Map<string, Promise<void>>();
  readonly #active = new Map<string, AbortController>();

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

  async runIntent<TResult>(
    sessionKey: string,
    signal: AbortSignal,
    intent: import('../turn/turn-ingress.js').TurnIntent,
    _principal: import('../turn/turn-ingress.js').TurnPrincipal,
    operation: (admit: () => void, signal: AbortSignal) => Promise<TResult>,
  ): Promise<TResult> {
    const previous = this.#tails.get(sessionKey) ?? Promise.resolve();
    const previousAdmission = this.#admissions.get(sessionKey);
    let admit!: () => void;
    let complete!: () => void;
    const admitted = new Promise<void>((resolve) => { admit = once(resolve); });
    const completed = new Promise<void>((resolve) => { complete = once(resolve); });
    const cumulative = Promise.all([previous.catch(() => undefined), completed]).then(() => undefined);
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal.reason);
    if (signal.aborted) abortFromCaller();
    else signal.addEventListener('abort', abortFromCaller, { once: true });
    this.#tails.set(sessionKey, cumulative);
    void cumulative.finally(() => {
      if (this.#tails.get(sessionKey) === cumulative) this.#tails.delete(sessionKey);
    });
    this.#admissions.set(sessionKey, admitted);
    try {
      if (intent.kind === 'new') {
        await waitForTurn(previous.catch(() => undefined), signal);
        this.#active.set(sessionKey, controller);
      } else if (intent.kind === 'supersede') {
        await waitForAdmission(previousAdmission, signal);
        this.#active.get(sessionKey)?.abort(new TurnSupersededError(sessionKey));
        await waitForTurn(previous.catch(() => undefined), signal);
        this.#active.set(sessionKey, controller);
      } else {
        await waitForAdmission(previousAdmission, signal);
      }
      return await operation(admit, controller.signal);
    } finally {
      signal.removeEventListener('abort', abortFromCaller);
      admit();
      complete();
      if (this.#active.get(sessionKey) === controller) this.#active.delete(sessionKey);
      if (this.#admissions.get(sessionKey) === admitted) this.#admissions.delete(sessionKey);
    }
  }
}

export type AgentTurnExecutor = (
  context: AgentTurnExecutionContext,
) => AsyncGenerator<
  import('../event/turn-event.js').TurnEvent,
  import('../turn/execute-agent-turn.js').TurnTerminalProjection | void
>;

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
  /** Where finished TurnTraces go (`zhin trace`). Omit to disable tracing. */
  readonly turnTraceStore?: TurnTraceStore;
}

export interface AgentCapabilitySelection {
  /** Immutable model/provider binding selected for this turn. */
  readonly binding: ResolvedAgentBinding;
  /** Binding-local MCP names. Empty means no MCP capability is exposed. */
  readonly mcpServers: readonly string[];
  /** Optional owner-visible specialist selected by the ingress router. */
  readonly agent?: string;
}

export class AgentRuntime extends SnapshotAttachedRuntime {
  readonly #ingress = new CapabilityIngress();
  readonly #usageLogger = getLogger('ai.usage');

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
    if (!request.intent) throw new TypeError('AgentRuntime requires an explicit Turn intent');
    const intent = request.intent;
    return this.options.coordinator.runIntent(
      request.session.key,
      request.signal,
      intent,
      request.principal,
      (admit, signal) => this.#executeLeased(
        lease,
        owner,
        { ...request, signal },
        selection,
        observe,
        admit,
      ),
    );
  }

  async #executeLeased(
    lease: SnapshotLease,
    owner: PluginId,
    request: TurnRequest,
    selection: AgentCapabilitySelection,
    observe?: TurnEventObserver,
    admit: () => void = () => undefined,
  ): Promise<TurnOutcome> {
    let active = true;
    const usageStore = lease.value.resources.get(lease.value.root)?.get(agentUsageStoreToken.id) as AgentUsageStore | undefined;
    const usage = usageStore ? new AgentUsageCollector(String(owner), request, {
      provider: selection.binding.providerAlias, model: selection.binding.model,
    }) : undefined;
    let usageStatus = 'failed';
    let activeTrace: TurnTraceCollector | undefined;
    let releaseTrace: (() => void) | undefined;
    let outcome: TurnOutcome | undefined;
    const logContext: UsageLogContext = {
      traceId: request.identity.traceId,
      scene: request.origin.kind === 'im' ? `${request.origin.platform}/${request.origin.scope}` : request.origin.kind,
      selectedModel: `${selection.binding.providerAlias}/${selection.binding.model}`,
    };
    try {
      if (!active) throw new Error('Agent generation operation is not active');
      const discovered = await this.#ingress.read(
        lease.value,
        owner,
        () => active && lease.active,
        request,
        selection.agent,
      );
      const referenceCapability = createConversationReferenceCapability(owner, request);
      // #726: the initiator's trust level caps the turn (group members: no shell, writes or outbound).
      const allTools = [
        ...discovered.tools,
        ...(referenceCapability ? [referenceCapability] : []),
        ...await expandMcpTools(discovered, selection.mcpServers),
      ];
      const trust = applyTurnTrust(request, allTools);
      const capabilities = Object.freeze({
        ...discovered,
        tools: Object.freeze([...trust.tools]),
      });
      const turnRequest = trust.restricted
        ? Object.freeze({ ...request, policy: trust.policy })
        : request;
      const trace = this.options.turnTraceStore || this.#usageLogger.isLevelEnabled('info')
        ? new TurnTraceCollector({
          turnId: request.identity.turnId,
          sessionKey: request.session.key,
          origin: request.origin,
          maxRequestBytes: this.options.turnTraceStore?.maxBytes,
          principal: { ...request.principal, trustLevel: trust.level },
        })
        : undefined;
      releaseTrace = trace ? registerTurnTrace(trace) : undefined;
      activeTrace = trace;
      const turn = createIngressTurn(lease.value, turnRequest, capabilities, trace, usage);
      const catalog = Object.freeze({
        ...capabilities,
        tools: Object.freeze(capabilities.tools.map(({ execute: _execute, ...tool }) => Object.freeze(tool))),
      });
      const tools = new TurnToolRuntime(turn, capabilities.tools);
      const engine = resolveTurnEngine(lease.value);
      const disabled = Boolean(request.session.key.startsWith('workroom:') || request.input.metadata?.workroom
        || request.principal.roles.includes('workroom_assignment') || request.execution?.kind === 'schedule');
      outcome = await runWithAgentDecisionTurn(lease.value, request.identity.turnId, decision => runWithAgentTurnConfiguration(
        { activeBinding: selection.binding },
        () => executeAgentTurn(turn, async function* () {
          const stream = engine.run({
          turn,
          capabilities: catalog,
          tools,
          toolCapabilities: capabilities.tools,
          selection,
          decision,
          admit,
          });
          try {
            while (true) {
              const next = await stream.next();
              for (const observation of drainAgentTurnDecisionObservations()) {
                yield { type: 'decision_evaluation', ...observation };
              }
              if (next.done) return next.value;
              yield next.value;
            }
          } catch (error) {
            // A later engine failure must not erase already completed decisions.
            for (const observation of drainAgentTurnDecisionObservations()) {
              yield { type: 'decision_evaluation', ...observation };
            }
            throw error;
          } finally {
            await stream.return(undefined);
          }
        }, observe),
      ), { disabled });
      usageStatus = outcome.status;
      return outcome;
    } catch (error) {
      usageStatus = request.signal.aborted ? 'cancelled' : 'failed';
      if (!activeTrace && this.#usageLogger.isLevelEnabled('info')) {
        activeTrace = new TurnTraceCollector({ turnId: request.identity.turnId, sessionKey: request.session.key });
      }
      activeTrace?.finalize({ status: request.signal.aborted ? 'cancelled' : 'failed' });
      throw error;
    } finally {
      active = false;
      releaseTrace?.();
      if (activeTrace) this.#saveTrace(activeTrace, { ...logContext, status: outcome?.status });
      if (usage && usageStore) {
        try { await usageStore.save(usage.finish(usageStatus)); }
        catch {
          // No model response, prompt or database error text enters this diagnostic.
          try { this.#usageLogger.error('op=usage_persist status=failed; 本轮用量未写入数据库'); } catch { /* Transport failure cannot change delivery. */ }
        }
      }
    }
  }

  #saveTrace(trace: TurnTraceCollector, context: UsageLogContext): void {
    trace.finalize();
    const snapshot = trace.snapshot();
    logTurnUsage(this.#usageLogger, snapshot, context);
    // Fire-and-forget: a slow or failing trace write must not delay the reply.
    void this.options.turnTraceStore?.save(snapshot).catch(() => undefined);
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

async function waitForAdmission(previous: Promise<void> | undefined, signal: AbortSignal): Promise<void> {
  if (!previous) return;
  await waitForTurn(previous.catch(() => undefined), signal);
}

function once(callback: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    callback();
  };
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
        mcpServer: connection.qualifiedName,
        name,
        qualifiedName: name,
        description: tool.description?.trim() || `${connection.name} MCP tool ${tool.name}`,
        inputSchema: tool.inputSchema === undefined
          ? undefined
          : requireToolInputSchema(tool.inputSchema, `MCP Tool ${name} inputSchema`),
        requiresApproval: 'on-risk' as const,
        source: connection.source,
        execute: <TInput = unknown, TResult = unknown>(input: TInput, invocation: ToolInvocationContext) =>
          connection.callTool<TResult>(tool.name, input, invocation),
      }));
    }
  }
  return expanded;
}

function createIngressTurn(
  snapshot: import('@zhin.js/plugin-runtime').RuntimeSnapshot,
  request: TurnRequest,
  capabilities: AgentCapabilities,
  trace?: TurnTraceCollector,
  usage?: AgentUsageCollector,
) {
  const journal = new PersistentTurnJournal({
    sessionId: request.session.key,
    turnId: request.identity.turnId,
  }, resolveJournalStore(snapshot), request.principal);
  const traced = trace ? createTracingJournal(journal, trace) : journal;
  const observed = usage ? { append(event: TurnEvent) { usage.record(event); return traced.append(event); } } : traced;
  return createTurnIngress({
    ...request,
    hostProtectedPaths: resolveHostProtectedPaths(snapshot),
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
      journal: createJournalFeed(observed, {
        turnId: request.identity.turnId,
      }),
    },
  });
}

/** The generation's host-protected paths; absent for embedders, which keeps the fail-closed fallback. */
function resolveHostProtectedPaths(
  snapshot: import('@zhin.js/plugin-runtime').RuntimeSnapshot,
): HostProtectedPaths | undefined {
  return snapshot.resources.get(snapshot.root)?.get(hostProtectedPathsToken.id) as HostProtectedPaths | undefined;
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
