import { createEvalInference } from './inference.js';
import { runWithAgentTurnConfiguration } from '../../src/turn/agent-turn-context.js';
import { createScopedPerceptionFactory } from '../../src/media/scoped-perception.js';
import { renderAgentOutput } from '../../src/outbound/agent-output.js';
import { plannedReplyTexts } from '../../src/session/context-provenance.js';
/**
 * Engine driver: assembles the smallest real host (ZhinAgent + AgentCore +
 * session/context systems) around the scripted model, builds a canonical
 * TurnIngress per inbound message and runs it through FullAgentTurnEngine.
 */
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  expandChatRole,
  hostChatRole,
  type ChatRole,
  type ChatRoleLevels,
  createVenueProjector,
  createVenueRegistry,
  routeVenueMessage,
  type VenueDefinition,
} from '@zhin.js/core';
import { childPluginId, createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { defineAgentPromptSection, type PromptSectionDescriptor } from '@zhin.js/prompt-section';
import { ToolIndex, type ToolAvailabilityContext } from '@zhin.js/tool';
import { collaborationIdle } from '../../src/collaboration/registry.js';
import { DEFAULT_ENGAGEMENT_BUDGET, HostMailbox } from '../../src/collaboration/host-mailbox.js';
import type { BudgetAmounts } from '@zhin.js/harness';
import { runInMailTurn } from '../../src/collaboration/mail-turn-context.js';
import { normalizeMailboxConfig } from '../../src/turn/mailbox-config.js';
import type { TurnAdmission } from '../../src/turn/turn-admission.js';
import type { AgentDescriptor } from '@zhin.js/agent-feature';
import { AgentCore } from '../../src/core/agent-core.js';
import { DEFAULT_AGENT_CORE_CONFIG, createDefaultAgentCoreDeps } from '../../src/core/compose-deps.js';
import { isTurnTerminalEvent, type TurnEvent, type TurnTerminalEvent } from '../../src/event/turn-event.js';
import { asPrivate } from '../../src/internal/as-private.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import type { AgentTurnExecutionContext } from '../../src/plugin-runtime/agent-runtime.js';
import { createFullAgentTurnEngine } from '../../src/plugin-runtime/full-agent-turn-engine.js';
import { NativeBashToolFeature } from '../../src/plugin-runtime/native-bash-tool.js';
import { createNativeFileToolFeatures } from '../../src/plugin-runtime/native-file-tools.js';
import { createNativeWebToolFeatures } from '../../src/plugin-runtime/native-web-tools.js';
import { createNativeSemanticMemoryToolFeatures, SemanticMemoryRuntime } from '../../src/plugin-runtime/native-semantic-memory-tools.js';
import { InMemoryMemoryEntryRepository } from '@zhin.js/ai';
import { createNativeSelfChangeToolFeatures } from '../../src/plugin-runtime/native-self-change-tools.js';
import { createHostProtectedPaths } from '../../src/security/host-config-paths.js';
import { ToolApprovalQueue } from '../../src/security/tool-approval-queue.js';
import { SelfChangeApprovals } from '../../src/self-change/approval.js';
import { SelfChangeStore, type SelfChangeOrigin } from '../../src/self-change/store.js';
import type { ApprovalOutcome, ApprovalOutcomePort } from '../../src/session/approval-port.js';
import { applyTurnTrust, resolveTurnTrustLevel } from '../../src/security/trust-level.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress, type ConversationContextPort, type ReferencePort, type TurnPolicyContext } from '../../src/turn/turn-ingress.js';
import { ZhinAgent } from '../../src/zhin-agent/index.js';
import { TurnTraceCollector, type TurnTrace } from '../../src/trace/turn-trace.js';
import { createTracingJournal, registerTurnTrace } from '../../src/trace/turn-trace-registry.js';
import type { SkillDescriptor } from '@zhin.js/skill';
import { createJournalFeed } from '../../src/turn/journal-feed.js';
import { executeAgentTurn } from '../../src/turn/execute-agent-turn.js';
import { routeSpecialistAgent } from '../../src/plugin-runtime/ingress/unified-mailbox-spine.js';
import { isTimerInbound, type EvalAgentFixture, type EvalApprovalBehaviour, type EvalCase, type EvalSelfChangeStatus, type EvalPromptSection, type EvalSkill, type EvalInbound, type EvalInboundMessage, type EvalNativeTool, type EvalTimerInbound, type EvalTool } from './fixture.js';
import { createScriptedModel, PERCEPTION_MODEL_ID, PERCEPTION_PROVIDER_ALIAS, type ScriptedModel, type ScriptedModelRequest } from './scripted-model.js';
import { resolvePerceptionConfig } from '../../src/media/perception.js';
import { createFakeClock, type EvalClock } from './fake-clock.js';
import type { ImageAssetPublisher } from '../../src/media/image-assets.js';

export interface EvalToolInvocation {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/** Everything observable about a case run; assertions only read this. */
export interface EvalRunRecord {
  readonly events: readonly TurnEvent[];
  /** Tools the harness actually executed (after policy and approval). */
  readonly executedTools: readonly EvalToolInvocation[];
  /** Tool calls the scripted model made, including ones policy or approval blocked. */
  readonly attemptedTools: readonly string[];
  /** Every text sent through the reply port (final replies and progress updates). */
  readonly outbound: readonly string[];
  /** Raw mocked tool results, as text, for leak checks. */
  readonly rawToolOutputs: readonly string[];
  readonly approvalRequests: readonly string[];
  /** Question text of every approval request, in order. */
  readonly approvalQuestions: readonly string[];
  /** Terminal event of each turn, in order. */
  readonly terminals: readonly TurnTerminalEvent[];
  readonly modelRequests: readonly ScriptedModelRequest[];
  readonly unusedScriptSteps: number;
  /** Unconsumed script steps per actor (only actors with any left); entry steps are under `zhin`. */
  readonly unusedActorSteps: Readonly<Record<string, number>>;
  /** Model requests made after the script ran out. */
  readonly extraModelRequests: number;
  /** Requests after an actor's own queue ran out, per actor. */
  readonly extraActorRequests: Readonly<Record<string, number>>;
  /** Scripted tool calls naming a tool the harness did not offer on that request. */
  readonly unofferedToolCalls: readonly string[];
  /** Script steps pinned to a model id that went to a different model. */
  readonly modelMismatches: readonly string[];
  /** `notOffered` scripted calls that the harness offered after all. */
  readonly unexpectedlyOfferedToolCalls: readonly string[];
  /** One TurnTrace per inbound turn, built exactly as production builds them. */
  readonly traces: readonly TurnTrace[];
  /** Self-changes in the store after the run, oldest first (`change_draft` cases). */
  readonly selfChanges: readonly Readonly<{ id: string; status: EvalSelfChangeStatus }>[];
  /** Production workspace files named by `expect.workspaceFiles`, read after the run (`null` = absent). */
  readonly workspaceFiles: Readonly<Record<string, string | null>>;
  /** ADR 0048 H4: projected collaboration hops sent through the VenueProjector. */
  readonly venueProjections: readonly Readonly<{ endpointId: string; text: string }>[];
}

const ENDPOINT = 'eval-bot';
const PLATFORM = 'eval';

export interface RunEvalCaseOptions {
  /** Synthetic image publisher; tests never access a real bucket. */
  readonly imageAssets?: ImageAssetPublisher;
  /**
   * Virtual clock for provider request timeouts. Defaults to a fresh fake
   * clock, so no eval waits in real time and timers fire only on `hang` steps.
   */
  readonly clock?: EvalClock;
  /**
   * Model source for the case. Defaults to the case's scripted model (PR
   * gate). The nightly tier passes a factory returning {@link createLiveModel}
   * so the same case runs against a real provider; the script is then unused.
   */
  readonly model?: (definition: EvalCase, clock: EvalClock) => ScriptedModel;
}

export async function runEvalCase(definition: EvalCase, options: RunEvalCaseOptions = {}): Promise<EvalRunRecord> {
  const workspace = definition.workspace ? await createWorkspace(definition.workspace) : undefined;
  try {
    const clock = options.clock ?? createFakeClock();
    return await runInWorkspace(definition, workspace, clock, options.model?.(definition, clock), options.imageAssets);
  } finally {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  }
}

async function runInWorkspace(
  definition: EvalCase,
  workspace: string | undefined,
  clock: EvalClock,
  liveModel: ScriptedModel | undefined,
  imageAssets?: ImageAssetPublisher,
): Promise<EvalRunRecord> {
  const inboundList: readonly EvalInbound[] = Array.isArray(definition.inbound) ? definition.inbound : [definition.inbound];
  /** ADR 0048 H3 mid-turn delivery hook, bound once the mailbox exists. */
  let onModelRequest: ((entryStep: number | undefined) => Promise<void>) | undefined;
  const model = liveModel ?? createScriptedModel(definition.script, {
    extraModels: definition.models,
    clock,
    ...(inboundList.some((message) => !isTimerInbound(message) && message.deliver) ? { onRequest: (entryStep: number | undefined) => onModelRequest?.(entryStep) } : {}),
    ...(definition.contextWindow ? { contextWindow: definition.contextWindow } : {}),
    ...(definition.modelInput ? { input: definition.modelInput } : {}),
    ...(definition.perception ? { perception: true } : {}),
    ...(definition.modelInputs ? { modelInputs: definition.modelInputs } : {}),
  });
  const toolNames = [
    ...(definition.tools ?? []).filter((tool) => !tool.deferred).map((tool) => tool.name),
    // Memory and web tools stay resident so their cases exercise policy, not discovery.
    ...(definition.nativeTools ?? []).filter((name) => name.startsWith('memory_') || name.startsWith('web_') || name === 'change_draft'),
  ];
  // Mocked tools are always loaded so scripts can call them without a
  // discover/load_tool round trip; the scene-tier defaults still apply on top (ADR 0042 §2).
  const alwaysLoadedTools = [
    ...(definition.agentConfig?.deferredTools?.alwaysLoadedTools ?? []),
    ...toolNames,
  ];
  const agent = new ZhinAgent({ config: {
    maxIterations: 6,
    toolExecution: 'sequential',
    providerTimers: clock,
    ...definition.agentConfig,
    deferredTools: {
      ...definition.agentConfig?.deferredTools,
      alwaysLoadedTools,
    },
  } });
  agent.activeBinding = { name: 'zhin', mcpServers: [] };
  agent.markMemoryPersistenceReady();
  // The CLI host hands bootstrap to the turn engine (not the agent setter); mirror that.
  const bootstrapContext = definition.hostBootstrap ? await hostBootstrapText(process.cwd()) : undefined;
  if (definition.sessionOps) {
    await agent.sessionOps.set({ expectedRevision: 0, actorId: 'eval-operator', ...definition.sessionOps });
  }
  // Semantic memory (seeds and/or memory tools) also drives per-turn recall (#734).
  const semanticMemory = await createEvalSemanticMemory(definition);
  if (semanticMemory) agent.configure({ semanticMemory });
  const perceptionConfig = definition.perception && !liveModel
    ? resolvePerceptionConfig({
      provider: PERCEPTION_PROVIDER_ALIAS,
      model: PERCEPTION_MODEL_ID,
      ...(definition.perception.fallbacks ? { fallbacks: definition.perception.fallbacks.map((id) => ({ provider: model.providerAlias, model: id })) } : {}),
      ...(definition.perception.kinds ? { kinds: definition.perception.kinds } : {}),
      ...(definition.perception.maxChars ? { maxChars: definition.perception.maxChars } : {}),
      ...(definition.perception.maxItemsPerTurn ? { maxItemsPerTurn: definition.perception.maxItemsPerTurn } : {}),
    })
    : undefined;
  const inference = createEvalInference(model, liveModel ? { ...definition, perception: undefined } : definition);
  const perception = createScopedPerceptionFactory();
  const host = asPrivate(agent);
  if (imageAssets) agent.configure({ imageAssets });
  const { sessionSystem, contextSystem } = host;
  if (!sessionSystem || !contextSystem) throw new Error('ZhinAgent did not compose its session/context systems');
  const engine = createFullAgentTurnEngine({
    host,
    core: new AgentCore(DEFAULT_AGENT_CORE_CONFIG, createDefaultAgentCoreDeps()),
    sessionSystem,
    contextSystem,
    ...(bootstrapContext ? { bootstrapContext } : {}),
  });

  const mailbox = new HostMailbox({ config: normalizeMailboxConfig(definition.agentConfig?.mailbox) });
  const executedTools: EvalToolInvocation[] = [];
  const rawToolOutputs: string[] = [];
  const outbound: string[] = [];
  const venueProjections: Array<Readonly<{ endpointId: string; text: string }>> = [];
  const approvalRequests: string[] = [];
  const approvalQuestions: string[] = [];
  const events: TurnEvent[] = [];
  const terminals: TurnTerminalEvent[] = [];
  const traces: TurnTrace[] = [];
  const venueDef: VenueDefinition | undefined = definition.venue
    ? Object.freeze({
        id: definition.venue.id ?? 'eval-venue',
        conversation: {
          platform: PLATFORM,
          sceneType: 'group' as const,
          sceneId: 'eval-group',
        },
        members: definition.venue.members.map((member) => ({
          agent: member.agent,
          botEndpoint: member.botEndpoint,
          ...(member.aliases?.length ? { aliases: [...member.aliases] } : {}),
        })),
        ...(definition.venue.entry ? { entry: definition.venue.entry } : {}),
        visibility: definition.venue.visibility ?? 'summary',
      })
    : undefined;
  if (venueDef) {
    const venueRegistry = createVenueRegistry([venueDef]);
    const venueProjector = createVenueProjector({
      registry: venueRegistry,
      send: async (sendInput) => {
        venueProjections.push(Object.freeze({ endpointId: sendInput.endpointId, text: sendInput.text }));
        outbound.push(`[${sendInput.endpointId}] ${sendInput.text}`);
      },
    });
    mailbox.setVenueProjector(venueProjector);
  }
  const selfChange = workspace && definition.nativeTools?.includes('change_draft')
    ? await createEvalSelfChange(definition, workspace)
    : undefined;
  try {
    const native = await nativeCapabilities(
      definition.nativeTools ?? [], definition.bashOutput ?? '', semanticMemory, executedTools, rawToolOutputs, selfChange,
    );
    const tools = [
      ...(definition.tools ?? []).map((tool) => toCapability(tool, executedTools, rawToolOutputs)),
      ...native.tools,
    ];
    const approval = createApprovalPort(definition.approval ?? 'approve', approvalRequests, approvalQuestions);

    // ADR 0048 H3: every inbound is a human Mail of the host Mailbox, and each
    // `run` admission is one Mail turn, exactly as the IM ingress route does.
    const runInbound = async (message: EvalInboundMessage, index: number): Promise<void> => {
      // ADR 0048 §3.4 invariant 7: non-human messages (self, member, peer_bot) never open a human Mail turn.
      if (message.origin !== undefined && message.origin !== 'human') return;
      const sender = message.sender ?? { id: 'eval-user', roles: ['user'] };
      const scope = message.scope ?? (venueDef ? 'group' : 'private');
      const sceneId = scope === 'group' ? 'eval-group' : sender.id;
      const venueRoute = venueDef
        ? routeVenueMessage({
            venue: venueDef,
            text: message.text,
            ...(message.mentions ? { mentions: message.mentions } : {}),
            ...(message.replyToSenderId ? { replyToSenderId: message.replyToSenderId } : {}),
            winningEndpointId: message.endpointId ?? venueDef.members[0]?.botEndpoint ?? ENDPOINT,
          })
        : undefined;
      const agentsList = evalAgents(definition);
      const routed = routeSpecialistAgent(
        message.text,
        { agents: agentsList },
        venueRoute?.member.agent,
        'zhin',
        PLATFORM,
      );
      const entryActor = routed.agent?.name ?? venueRoute?.member.agent ?? 'zhin';
      const admission = await mailbox.admit({
        sessionKey: sessionKeyFor(message),
        senderId: sender.id,
        entry: entryActor,
        text: routed.userText,
        plainText: !message.images?.length && !message.quote,
        isMaster: evalSenderRoles(sender).includes('owner'),
        ...(sender.name ? { senderName: sender.name } : {}),
        ...(message.addressed === false ? { unaddressed: true } : {}),
        ...(venueDef
          ? {
              venue: Object.freeze({
                kind: scope,
                id: venueDef.id,
                platform: PLATFORM,
                sceneType: scope,
                sceneId,
                ...(venueRoute?.member.botEndpoint ? { accountId: venueRoute.member.botEndpoint } : {}),
              }),
            }
          : {}),
      });
      if (admission.kind !== 'run') return;
      await runAdmitted({ ...message, scope, text: routed.userText }, index, admission, entryActor);
    };
    const runAdmitted = async (
      message: EvalInboundMessage,
      index: number,
      admission: Extract<TurnAdmission, { kind: 'run' }>,
      entryActor = 'zhin',
    ): Promise<void> => {
      const trace = createTurnTrace(definition, message, index);
      const releaseTrace = registerTurnTrace(trace);
      // A merged / superseding batch answers every mail in it.
      const admitted = admission.batch.length > 1 ? { ...message, text: admission.text } : message;
      // Timer Mail carries its own engagement grant; stop the entry turn when it runs out (invariant 2).
      const allowance = admission.mail.body.kind === 'timer' ? admission.harness.remaining(admission.mail) : undefined;
      const budgetStop = allowance ? new AbortController() : undefined;
      const turnSignal = budgetStop ? AbortSignal.any([admission.signal, budgetStop.signal]) : admission.signal;
      let modelRequests = 0;
      let usageTokens = 0;
      const budgetExhausted = (): boolean => Boolean(allowance && (
        modelRequests >= allowance.modelCalls || (allowance.tokens > 0 && usageTokens >= allowance.tokens)
      ));
      const { turn, tools: turnTools } = buildTurn(definition, admitted, index, tools, native.available, approval, outbound, workspace, trace, {
        signal: turnSignal,
        // A superseded / stopped turn never sends; a stale reply is dropped (ADR 0038 §4).
        blocked: () => turnSignal.aborted || admission.staleCheck().kind === 'discard',
        delivered: () => admission.markDelivered(),
      }, entryActor);
      const context: AgentTurnExecutionContext = {
        turn,
        capabilities: {
          generation: 1,
          owner: rootPluginId(),
          tools: turnTools,
          skills: evalSkills(definition),
          agents: evalAgents(definition),
          mcp: [],
          promptSections: promptSections(definition),
        },
        toolCapabilities: turnTools,
        tools: new TurnToolRuntime(turn, turnTools),
        selection: {
          binding: { name: 'zhin', mcpServers: [] },
          mcpServers: [],
          ...(entryActor !== 'zhin' ? { agent: entryActor } : {}),
        },
      };
      let status: 'completed' | 'failed' | 'cancelled' = 'failed';
      const lease = inference.snapshots.acquire();
      const models = await inference.runtime.acquireForTurn({ request: turn, binding: context.selection.binding, lease, snapshots: inference.snapshots });
      const mediaPerception = perception({ scope: models, sessionKey: turn.session.key, settings: perceptionConfig,
        resilience: definition.agentConfig?.providerResilience, timers: clock });
      try {
        // Same path as AgentRuntime: the journal is the single source and
        // `events` is the journal-derived feed (includes authority tool events).
        await runInMailTurn({ mailbox, mail: admission.mail, batch: admission.batch }, () =>
          runWithAgentTurnConfiguration({ models, mediaPerception }, () => executeAgentTurn(turn, () => engine.run(context), (event) => {
            events.push(event);
            if (isTurnTerminalEvent(event)) terminals.push(event);
            if (!allowance || !budgetStop) return;
            if (event.type === 'iteration_start') {
              if (modelRequests > 0 && budgetExhausted() && !budgetStop.signal.aborted) {
                budgetStop.abort(Object.assign(new Error('budget exhausted'), { code: 'budget_exceeded' }));
              }
              return;
            }
            if (event.type !== 'usage') return;
            modelRequests += 1;
            usageTokens += event.usage.totalTokens;
            if ((modelRequests > allowance.modelCalls || (allowance.tokens > 0 && usageTokens > allowance.tokens)) && !budgetStop.signal.aborted) {
              budgetStop.abort(Object.assign(new Error('budget exhausted'), { code: 'budget_exceeded' }));
            }
          })));
        if (budgetStop?.signal.aborted) {
          // Still report what finished: the next unused entry text step is the turn's reply
          // (scripted eval stand-in for the actor-turn budget_exceeded report-back).
          const entrySteps = definition.script.filter((step) => step.actor === undefined);
          const leftover = entrySteps.slice(modelRequests);
          const report = leftover.find((step): step is { text: string } => 'text' in step && typeof step.text === 'string');
          if (report && !outbound.includes(report.text)) {
            outbound.push(report.text);
            admission.markDelivered();
          }
          if (modelRequests > 0 || usageTokens > 0) {
            await admission.harness.charge(admission.mail, { modelCalls: modelRequests, tokens: usageTokens });
          }
          const exceeded = Object.freeze({
            type: 'budget_exceeded' as const,
            budget: 'modelCalls',
            usage: Object.freeze({
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: usageTokens,
            }),
          });
          events.push(exceeded);
          terminals.push(exceeded);
          status = 'cancelled';
        } else {
          status = admission.signal.aborted ? 'cancelled' : 'completed';
        }
      } finally {
        admission.release(status);
        // Delegated work outlives the entry turn; wait for it (and the result turns it wakes) before observing.
        await collaborationIdle();
        await models.release(); lease.release();
        releaseTrace();
        trace.finalize();
        traces.push(trace.snapshot());
      }
    };

    const midTurn = inboundList
      .map((message, index) => ({ message, index }))
      .filter((pending): pending is { message: EvalInboundMessage; index: number } => !isTimerInbound(pending.message) && pending.message.deliver !== undefined);
    const spawned: Promise<void>[] = [];
    onModelRequest = async (entryStep) => {
      for (const pending of midTurn) {
        if (entryStep === undefined || pending.message.deliver?.duringStep !== entryStep) continue;
        spawned.push(runInbound(pending.message, pending.index));
      }
      if (entryStep !== undefined && midTurn.some(({ message }) => message.deliver?.duringStep === entryStep)) {
        // Let the Mailbox take the mail (and abort a superseded turn) before the step answers.
        for (let tick = 0; tick < 8; tick += 1) await new Promise<void>((resolve) => setImmediate(resolve));
      }
    };
    const runTimerInbound = async (inbound: EvalTimerInbound, index: number): Promise<void> => {
      const admission = await deliverTimerMailInbound(mailbox, inbound);
      if (admission.kind !== 'run') return;
      const owner = inbound.owner;
      const message: EvalInboundMessage = {
        text: inbound.content,
        sender: { id: owner.id, roles: [...evalSenderRoles(owner)] },
      };
      await runAdmitted(message, index, admission);
    };
    for (const [index, entry] of inboundList.entries()) {
      if (isTimerInbound(entry)) {
        await runTimerInbound(entry, index);
        while (spawned.length) await spawned.shift();
        continue;
      }
      const message = entry;
      if (message.deliver) continue;
      await runInbound(message, index);
      while (spawned.length) await spawned.shift();
    }

    const selfChanges = selfChange
      ? [...await selfChange.store.list()].sort((left, right) => left.createdAt - right.createdAt).map((record) => Object.freeze({ id: record.id, status: record.status as EvalSelfChangeStatus }))
      : [];
    const workspaceFiles: Record<string, string | null> = {};
    for (const relative of Object.keys(definition.expect.workspaceFiles ?? {})) {
      workspaceFiles[relative] = workspace ? await readWorkspaceFile(join(workspace, relative)) : null;
    }

    return {
      selfChanges,
      workspaceFiles,
      venueProjections,
      events,
      executedTools,
      attemptedTools: model.requests.flatMap((request) => request.toolCalls),
      outbound,
      rawToolOutputs,
      approvalRequests,
      approvalQuestions,
      terminals,
      modelRequests: model.requests,
      unusedScriptSteps: model.remainingSteps(),
      unusedActorSteps: model.remainingStepsByActor(),
      extraModelRequests: model.exhaustedRequests(),
      extraActorRequests: model.exhaustedRequestsByActor(),
      unofferedToolCalls: model.unofferedToolCalls,
      modelMismatches: model.modelMismatches,
      unexpectedlyOfferedToolCalls: model.unexpectedlyOfferedToolCalls,
      traces,
    };
  } finally {
    await mailbox.close('eval case finished');
    agent.hostMailbox.dispose();
    selfChange?.approvals.dispose();
    selfChange?.queue.dispose();
    await agent.dispose(); await inference.runtime.dispose(); await inference.snapshots.close();
  }
}

function buildTurn(
  definition: EvalCase,
  message: EvalInboundMessage,
  index: number,
  tools: readonly ToolCapability[],
  available: NativeAvailability,
  approval: ApprovalOutcomePort | undefined,
  outbound: string[],
  workspace: string | undefined,
  trace: TurnTraceCollector,
  gate: Readonly<{ signal: AbortSignal; blocked: () => boolean; delivered: () => void }>,
  entryActor = 'zhin',
) {
  const scope = message.scope ?? 'private';
  const sender = message.sender ?? { id: 'eval-user', roles: ['user'] };
  const roles = [...evalSenderRoles(sender)];
  const sceneId = scope === 'group' ? 'eval-group' : sender.id;
  const baseSessionKey = sessionKeyFor(message);
  const hasActorScript = entryActor !== 'zhin' && definition.script.some((step) => step.actor === entryActor);
  const sessionKey = hasActorScript ? `${baseSessionKey}#actor:${entryActor}` : baseSessionKey;
  const requestedPolicy: TurnPolicyContext = message.policy ?? defaultPolicy(roles, workspace, message.shell === true);
  const origin = { kind: 'im', platform: PLATFORM, endpoint: ENDPOINT, scope, sceneId } as const;
  // Per-turn availability (`isAvailable`), as capability ingress binds tools in production (#1051 F4).
  const visible = tools.filter((tool) => available(tool.name, {
    sessionKey,
    origin: { ...origin, messageId: `${definition.id}:turn-${index + 1}:message` },
    principal: { subjectId: sender.id, roles },
  }));
  // Same #726 trust rule AgentRuntime applies before a Turn starts.
  const trust = applyTurnTrust({ origin, principal: { roles }, policy: requestedPolicy }, visible);
  const policy = trust.policy;
  const turnTools = trust.tools;
  const turnId = `${definition.id}:turn-${index + 1}`;
  let replySequence = 0;
  const turn = createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: turnId, turnId },
    origin: { kind: 'im', platform: PLATFORM, endpoint: ENDPOINT, scope, sceneId, messageId: `${turnId}:message` },
    principal: { subjectId: sender.id, ...(sender.name ? { displayName: sender.name } : {}), roles },
    input: {
      text: message.text,
      ...(message.images?.length
        ? { media: message.images.map((image) => ({ kind: 'image' as const, source: { kind: 'base64' as const, value: image.base64 }, mimeType: image.mimeType, ...(image.name ? { name: image.name } : {}) })) }
        : {}),
      ...(message.mergedSenders?.length ? { mergedSenders: message.mergedSenders } : {}),
      ...(message.liveDanmaku ? { liveDanmaku: message.liveDanmaku } : {}),
      ...(message.quote ? { references: [{ key: 'ref-1', kind: 'message' as const, sourceId: message.quote.id }] } : {}),
    },
    session: { key: sessionKey },
    policy,
    capabilities: {
      tools: turnTools.map((tool) => tool.name),
      skills: evalSkills(definition).map((skill) => skill.qualifiedName),
    },
    signal: gate.signal,
    ports: {
      journal: createJournalFeed(createTracingJournal({ append: async () => undefined }, trace), { turnId }),
      reply: {
        send: async (output) => {
          if (gate.blocked()) return { status: 'suppressed' as const };
          const text = renderAgentOutput(output);
          outbound.push(text);
          gate.delivered();
          // This local port delivers the captured output unchanged. Supply the same
          // plain-text evidence the production receipt bridge verifies after sending.
          const messageContexts = plannedReplyTexts(output).flatMap(plannedText => plannedText === undefined ? [] : [{
            message: { conversation: { endpoint: { adapter: PLATFORM, id: ENDPOINT }, kind: scope, id: sceneId }, id: `${turnId}:reply-${++replySequence}` },
            plannedText,
          }]);
          return { status: 'sent' as const, ...(messageContexts.length ? { messageContexts } : {}) };
        },
      },
      ...(approval ? { approval } : {}),
      ...(message.backgroundEvents?.length ? { conversationContext: backgroundContext(message.backgroundEvents) } : {}),
      ...(message.quote ? { references: quoteReferencePort(message.quote) } : {}),
    },
  });
  return { turn, tools: turnTools };
}

/** The quoted message resolves the way an adapter's content port returns a `ConversationMessage`. */
function quoteReferencePort(quote: NonNullable<EvalInboundMessage['quote']>): ReferencePort {
  return {
    resolve: async () => ({
      status: 'resolved' as const,
      content: {
        ref: { id: quote.id },
        ...(quote.sender ? { actor: { id: quote.sender.id, ...(quote.sender.name ? { displayName: quote.sender.name } : {}) } } : {}),
        segments: [{ type: 'text', data: { text: quote.text } }],
        timestamp: quote.timestamp ?? 0,
      },
    }),
  };
}

/** Skills owned by the agent's root plugin, as a loaded SKILL.md would be. */
function evalSkills(definition: EvalCase): SkillDescriptor[] {
  return (definition.skills ?? []).map((skill: EvalSkill) => Object.freeze({
    $feature: 'zhin.skill/1' as const,
    owner: rootPluginId(),
    name: skill.name,
    qualifiedName: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    ...(skill.toolNames ? { toolNames: Object.freeze([...skill.toolNames]) } : {}),
    ...(skill.keywords ? { keywords: Object.freeze([...skill.keywords]) } : {}),
    source: `eval:skills/${skill.name}/SKILL.md`,
  }));
}

/**
 * ADR 0048 peer Agents as the descriptors `agents/<name>/` packages would produce, owned by the driver's root plugin.
 * `collaboration` (contacts / acceptsFrom) is the §2 policy; the shared descriptor type does not carry it yet, so it
 * rides along as an extra field for the engine's directory to read.
 */
function evalAgents(definition: EvalCase): AgentDescriptor[] {
  return (definition.agents ?? []).map((agent: EvalAgentFixture) => Object.freeze({
    $feature: 'zhin.agent/1' as const,
    name: agent.name,
    displayName: agent.name,
    version: '1.0.0',
    description: agent.description,
    triggerRules: Object.freeze({ filePatterns: Object.freeze([]), keywords: Object.freeze([]) }),
    entryPoints: Object.freeze(['system.md']),
    instructions: `You are ${agent.name}. ${agent.description} Do the work you are given with your own tools and answer concisely.`,
    workflows: Object.freeze([]),
    knowledge: Object.freeze([]),
    toolNames: Object.freeze([...agent.tools]),
    collaboration: Object.freeze({
      ...(agent.collaboration?.contacts !== undefined
        ? { contacts: Object.freeze([...agent.collaboration.contacts]) }
        : {}),
      // Omitted acceptsFrom means "anyone in scope", so it stays absent rather than becoming an empty list.
      ...(agent.collaboration?.acceptsFrom ? { acceptsFrom: Object.freeze([...agent.collaboration.acceptsFrom]) } : {}),
      ...(agent.collaboration?.budget ? { budget: Object.freeze({ ...agent.collaboration.budget }) } : {}),
    }),
    owner: rootPluginId(),
    qualifiedName: agent.name,
    source: `eval:agents/${agent.name}/agent.json`,
  } as AgentDescriptor));
}

/** Third-party plugin prompt sections, owned by a child plugin so the engine treats them as external_content. */
function promptSections(definition: EvalCase): PromptSectionDescriptor[] {
  return (definition.promptSections ?? []).map((section: EvalPromptSection, index) => {
    const name = `section-${index + 1}`;
    return Object.freeze({
      ...defineAgentPromptSection({ title: section.title, content: section.content }),
      owner: childPluginId(rootPluginId(), section.plugin),
      name,
      qualifiedName: `${section.plugin}:${name}`,
      source: `eval:${section.plugin}`,
      generation: 1,
    });
  });
}

function sessionKeyFor(message: EvalInboundMessage): string {
  const scope = message.scope ?? 'private';
  const senderId = message.sender?.id ?? 'eval-user';
  const sceneId = scope === 'group' ? 'eval-group' : senderId;
  return `im:${PLATFORM}:${ENDPOINT}:${scope}:${sceneId}`;
}

function createTurnTrace(definition: EvalCase, message: EvalInboundMessage, index: number): TurnTraceCollector {
  const sender = message.sender ?? { id: 'eval-user', roles: ['user'] };
  return new TurnTraceCollector({
    turnId: `${definition.id}:turn-${index + 1}`,
    sessionKey: sessionKeyFor(message),
    principal: {
      subjectId: sender.id,
      ...(sender.name ? { displayName: sender.name } : {}),
      roles: [...evalSenderRoles(sender)],
      trustLevel: resolveTurnTrustLevel({
        origin: { kind: 'im', scope: message.scope ?? 'private' },
        principal: { roles: evalSenderRoles(sender) },
      }),
    },
  });
}

function backgroundContext(texts: readonly string[]): ConversationContextPort {
  return {
    readPending: async () => ({
      cursor: texts.length,
      blocks: texts.map((text, index) => ({
        kind: 'conversation_event' as const,
        sequence: index + 1,
        eventType: 'message.created' as const,
        text,
      })),
    }),
    commit: async () => undefined,
  };
}

function toCapability(tool: EvalTool, executed: EvalToolInvocation[], rawOutputs: string[]): ToolCapability {
  return {
    owner: rootPluginId(),
    name: tool.name,
    qualifiedName: tool.name,
    description: tool.description ?? tool.name,
    ...(tool.parameters ? { inputSchema: tool.parameters } : {}),
    requiresApproval: tool.requiresApproval ?? 'never',
    ...(tool.risk ? { risk: tool.risk } : {}),
    source: `eval:${tool.name}`,
    execute: (async (input: unknown) => {
      const args = (input ?? {}) as Record<string, unknown>;
      executed.push({ name: tool.name, args });
      if (tool.error) throw new Error(tool.error);
      const result = typeof tool.result === 'function'
        ? (tool.result as (value: Record<string, unknown>) => unknown)(args)
        : tool.result ?? `ok:${tool.name}`;
      rawOutputs.push(typeof result === 'string' ? result : JSON.stringify(result));
      return result;
    }) as ToolCapability['execute'],
  };
}

function createApprovalPort(
  behaviour: EvalApprovalBehaviour,
  requests: string[],
  questions: string[],
): ApprovalOutcomePort | undefined {
  if (behaviour === 'unavailable') return undefined;
  const outcome: ApprovalOutcome = behaviour === 'approve'
    ? { status: 'approved', decision: 'approve-once' }
    : { status: 'denied', by: 'user' };
  return {
    available: true,
    requestApproval: async (request) => {
      requests.push(request.toolName);
      return outcome.status === 'approved';
    },
    requestApprovalOutcome: async (request) => {
      requests.push(request.toolName);
      questions.push(request.question ?? '');
      return outcome;
    },
  };
}

function defaultPolicy(roles: string[], workspace: string | undefined, shell: boolean): TurnPolicyContext {
  if (!workspace) return { permissions: roles, unattended: false };
  return {
    permissions: roles,
    unattended: false,
    filesystem: { workspaceRoot: workspace, workingDirectory: workspace, access: 'workspace-write' },
    ...(shell
      ? { shell: { security: 'allowlist', execPreset: 'development', approvalMode: 'auto', isolation: 'required' } as const }
      : {}),
  };
}

async function createWorkspace(files: Readonly<Record<string, string>>): Promise<string> {
  // realpath: macOS tmpdir is a symlink, and file policy compares resolved paths.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-eval-')));
  for (const [relative, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, relative)), { recursive: true });
    await writeFile(join(root, relative), content);
  }
  return root;
}

/** In-memory semantic memory for cases that seed entries or expose memory tools. */
async function createEvalSemanticMemory(definition: EvalCase): Promise<SemanticMemoryRuntime | null> {
  const usesTools = (definition.nativeTools ?? []).some((name) => name.startsWith('memory_'));
  if (!usesTools && !definition.memory?.length) return null;
  const repository = new InMemoryMemoryEntryRepository();
  for (const entry of definition.memory ?? []) await repository.upsert(entry);
  const runtime = new SemanticMemoryRuntime();
  runtime.activate(repository);
  return runtime;
}

/** Whether a tool is offered on a turn (native tools' `isAvailable`; mocked tools always are). */
type NativeAvailability = (name: string, context: ToolAvailabilityContext) => boolean;

interface EvalSelfChange {
  readonly store: SelfChangeStore;
  readonly approvals: SelfChangeApprovals;
  readonly queue: ToolApprovalQueue;
}

/**
 * A real self-change store and approval queue over the workspace (ADR 0040): drafts stage under
 * `.zhin/changes`, trials run their static checks, and a passing draft goes to a `self` approval card nobody
 * settles during the case. Seeded changes belong to the first inbound's conversation.
 */
async function createEvalSelfChange(definition: EvalCase, workspace: string): Promise<EvalSelfChange> {
  const store = new SelfChangeStore({
    root: join(workspace, '.zhin', 'changes'),
    projectRoot: workspace,
    protectedPaths: await createHostProtectedPaths({ projectRoot: workspace }),
  });
  const queue = new ToolApprovalQueue();
  const approvals = new SelfChangeApprovals({ store, queue });
  const seed = definition.selfChange?.pending;
  if (seed) {
    const first = (Array.isArray(definition.inbound) ? definition.inbound[0] : definition.inbound) as EvalInbound;
    const senderId = isTimerInbound(first) ? first.owner.id : first.sender?.id ?? 'eval-user';
    const scope = isTimerInbound(first) ? 'private' : first.scope ?? 'private';
    const origin: SelfChangeOrigin = {
      platform: PLATFORM,
      sceneId: `${scope}:${scope === 'group' ? 'eval-group' : senderId}`,
      userId: senderId,
      endpoint: ENDPOINT,
    };
    const draft = await store.draft({ origin, files: seed.files.map((file) => ({ path: file.path, content: file.content })) });
    await store.attachPlan(draft.id, draft.contentHash, {
      version: 1, contentHash: draft.contentHash, summary: seed.summary, files: [],
      impact: { kind: 'generation', subtrees: ['root'], slots: [], reasons: [], estimated: true, config: null },
    });
    await store.transition(draft.id, 'trialing', { actor: 'policy', reasonCode: 'change_drafted' });
    await store.transition(draft.id, 'ready', { actor: 'policy', trial: { passed: true, checks: [] } });
    await approvals.submit(draft.id);
  }
  return { store, approvals, queue };
}

/** `null` only when the file is absent; other read errors (EACCES, EISDIR…) surface instead of passing as "missing". */
async function readWorkspaceFile(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Real native tool definitions, executed through a ToolIndex; bash gets a
 * canned, shell-free port and memory tools an in-memory store.
 */
async function nativeCapabilities(
  names: readonly EvalNativeTool[],
  bashOutput: string,
  semanticMemory: SemanticMemoryRuntime | null,
  executed: EvalToolInvocation[],
  rawOutputs: string[],
  selfChange?: EvalSelfChange,
): Promise<{ tools: ToolCapability[]; available: NativeAvailability }> {
  if (names.length === 0) return { tools: [], available: () => true };
  const owner = rootPluginId();
  const bash = new NativeBashToolFeature({ execute: async () => ({ stdout: bashOutput, stderr: '' }) });
  const memoryFeatures = semanticMemory ? createNativeSemanticMemoryToolFeatures(semanticMemory) : [];
  const web = createNativeWebToolFeatures({
    request: async (url) => { throw new Error(`eval web transport never reaches the network (${url.href})`); },
  });
  const selfChangeFeatures = selfChange
    ? createNativeSelfChangeToolFeatures({ store: () => selfChange.store, approvals: () => selfChange.approvals })
    : [];
  const features = [bash, ...createNativeFileToolFeatures(), ...memoryFeatures, ...web, ...selfChangeFeatures]
    .filter((feature) => names.includes(feature.name as EvalNativeTool));
  const slots = features.map((feature) => createCapabilitySlot({
    owner,
    feature: feature.feature,
    localName: feature.name,
    source: `/builtin/${feature.name}`,
    definition: feature.definition,
  }));
  const index = new ToolIndex(slots, nativeSnapshot(slots));
  const nativeNames = new Set(index.list().map((descriptor) => descriptor.name));
  const available: NativeAvailability = (name, context) => !nativeNames.has(name) || index.isAvailable(owner, name, context);
  const tools = index.list().map((descriptor) => ({
    ...descriptor,
    execute: (async (input: unknown, invocation: Parameters<ToolCapability['execute']>[1]) => {
      executed.push({ name: descriptor.name, args: (input ?? {}) as Record<string, unknown> });
      const result = await index.execute({ requester: owner, name: descriptor.name, input, invocation: invocation as never });
      rawOutputs.push(typeof result === 'string' ? result : JSON.stringify(result));
      return result;
    }) as ToolCapability['execute'],
  }));
  return { tools, available };
}

function nativeSnapshot(slots: readonly ReturnType<typeof createCapabilitySlot>[]): RuntimeSnapshot {
  const root = rootPluginId();
  return {
    generation: 1,
    root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@zhin.js/agent-evals', packageRoot: '/', children: [] }]]),
    config: new Map([[root, {}]]),
    resources: new Map([[root, new Map()]]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  };
}

/** Same shape as the CLI host's bootstrap loader (`## <file>` sections, missing files skipped). */
async function hostBootstrapText(root: string): Promise<string> {
  const parts: string[] = [];
  for (const name of ['SOUL.md', 'AGENTS.md', 'TOOLS.md']) {
    const body = (await readFile(join(root, name), 'utf8').catch(() => '')).trim();
    if (body) parts.push(`## ${name}\n${body}`);
  }
  return parts.join('\n\n');
}

/**
 * @deprecated Gap A closed in ADR 0048 H3 PR-3; kept so older tests that imported the phrase still resolve.
 */
export const TIMER_INBOUND_NOT_SUPPORTED = 'ADR 0048 H3 HOOK GAP: timer Mail inbound not supported';

function engagementBudget(partial: Partial<BudgetAmounts> | undefined): BudgetAmounts {
  if (!partial) return DEFAULT_ENGAGEMENT_BUDGET;
  return Object.freeze({
    modelCalls: partial.modelCalls ?? DEFAULT_ENGAGEMENT_BUDGET.modelCalls,
    tokens: partial.tokens ?? DEFAULT_ENGAGEMENT_BUDGET.tokens,
    wallMs: partial.wallMs ?? DEFAULT_ENGAGEMENT_BUDGET.wallMs,
    sideEffects: partial.sideEffects ?? DEFAULT_ENGAGEMENT_BUDGET.sideEffects,
  });
}

/**
 * ADR 0048 H3 Gap A: post a timer inbound as `timer` Mail onto the target actor's Mailbox
 * (lane `timer:<timerId>`), not through the human Venue path. The owner is the engagement
 * principal and the Venue reply target.
 */
export async function deliverTimerMailInbound(
  mailbox: HostMailbox,
  inbound: EvalTimerInbound,
): Promise<TurnAdmission> {
  const owner = inbound.owner;
  const roles = evalSenderRoles(owner);
  const isMaster = roles.includes('owner');
  const ownerSession = `im:${PLATFORM}:${ENDPOINT}:private:${owner.id}`;
  return mailbox.admit({
    sessionKey: `timer:${inbound.timerId}`,
    senderId: owner.id,
    text: inbound.content,
    plainText: true,
    kind: 'timer',
    timerId: inbound.timerId,
    ...(inbound.target ? { entry: inbound.target } : {}),
    isMaster,
    trust: isMaster ? 'master' : 'trusted',
    venue: Object.freeze({ kind: 'turn', id: ownerSession }),
    ...(inbound.budget ? { budget: engagementBudget(inbound.budget) } : {}),
  });
}

/** Role facts of an eval sender, shaped like the Host's `sender.chatRole` / `sender.chatRoleLevels` (ADR 0056). */
export type EvalSender = Readonly<{
  id: string; name?: string; roles?: readonly string[];
  chatRole?: ChatRole;
  /** Levels the roles are held at; as on the Host, a role without a level counts as conversation level. */
  chatRoleLevels?: ChatRoleLevels;
}>;

/**
 * Principal roles of an eval sender: `chatRole` expanded the way the Host derives host-wide trust
 * (`hostChatRole`: only a global owner is `owner`, a lower-level owner counts as `admin`), else `roles`, else `user`.
 */
export function evalSenderRoles(sender: Omit<EvalSender, 'id'>): readonly string[] {
  if (sender.chatRole) return expandChatRole(hostChatRole(sender));
  return sender.roles ?? ['user'];  // eval principal roles (not message sender roles)
}
