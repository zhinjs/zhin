import { renderAgentOutput } from '../../src/outbound/agent-output.js';
/**
 * Engine driver: assembles the smallest real host (ZhinAgent + AgentCore +
 * session/context systems) around the scripted model, builds a canonical
 * TurnIngress per inbound message and runs it through FullAgentTurnEngine.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { childPluginId, createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { defineAgentPromptSection, type PromptSectionDescriptor } from '@zhin.js/prompt-section';
import { ToolIndex } from '@zhin.js/tool';
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
import type { ApprovalOutcome, ApprovalOutcomePort } from '../../src/session/approval-port.js';
import { applyTurnTrust, resolveTurnTrustLevel } from '../../src/security/trust-level.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress, type ConversationContextPort, type TurnPolicyContext } from '../../src/turn/turn-ingress.js';
import { DEFAULT_DEFERRED_TOOLS_CONFIG } from '../../src/tool-catalog/types.js';
import { ZhinAgent } from '../../src/zhin-agent/index.js';
import { TurnTraceCollector, type TurnTrace } from '../../src/trace/turn-trace.js';
import { createTracingJournal, registerTurnTrace } from '../../src/trace/turn-trace-registry.js';
import type { SkillDescriptor } from '@zhin.js/skill';
import { createJournalFeed } from '../../src/turn/journal-feed.js';
import { executeAgentTurn } from '../../src/turn/execute-agent-turn.js';
import type { EvalApprovalBehaviour, EvalCase, EvalMemoryEntry, EvalPromptSection, EvalSkill, EvalInboundMessage, EvalNativeTool, EvalTool } from './fixture.js';
import { createScriptedModel, PERCEPTION_MODEL_ID, PERCEPTION_PROVIDER_ALIAS, type ScriptedModel, type ScriptedModelRequest } from './scripted-model.js';
import { createLlmMediaPerceptionPort, resolvePerceptionConfig } from '../../src/media/perception.js';
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
  /** Model requests made after the script ran out. */
  readonly extraModelRequests: number;
  /** Scripted tool calls naming a tool the harness did not offer on that request. */
  readonly unofferedToolCalls: readonly string[];
  /** Script steps pinned to a model id that went to a different model. */
  readonly modelMismatches: readonly string[];
  /** `notOffered` scripted calls that the harness offered after all. */
  readonly unexpectedlyOfferedToolCalls: readonly string[];
  /** One TurnTrace per inbound turn, built exactly as production builds them. */
  readonly traces: readonly TurnTrace[];
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
  const model = liveModel ?? createScriptedModel(definition.script, {
    extraModels: definition.models,
    clock,
    ...(definition.contextWindow ? { contextWindow: definition.contextWindow } : {}),
    ...(definition.modelInput ? { input: definition.modelInput } : {}),
    ...(definition.perception ? { perception: true } : {}),
    ...(definition.modelInputs ? { modelInputs: definition.modelInputs } : {}),
  });
  const toolNames = [
    ...(definition.tools ?? []).filter((tool) => !tool.deferred).map((tool) => tool.name),
    // Memory and web tools stay resident so their cases exercise policy, not discovery.
    ...(definition.nativeTools ?? []).filter((name) => name.startsWith('memory_') || name.startsWith('web_')),
  ];
  // Mocked tools are always loaded so scripts can call them without a
  // discover/load_tool round trip; the default always-loaded set is kept.
  const alwaysLoadedTools = [
    ...(definition.agentConfig?.deferredTools?.alwaysLoadedTools ?? DEFAULT_DEFERRED_TOOLS_CONFIG.alwaysLoadedTools),
    ...toolNames,
  ];
  const agent = new ZhinAgent(model.provider, {
    maxIterations: 6,
    toolExecution: 'sequential',
    providerTimers: clock,
    ...definition.agentConfig,
    deferredTools: {
      ...definition.agentConfig?.deferredTools,
      alwaysLoadedTools,
    },
  }, undefined, model.runtime);
  agent.activeBinding = { name: 'zhin', providerAlias: model.providerAlias, model: model.modelId, mcpServers: [] };
  agent.markMemoryPersistenceReady();
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
  if (perceptionConfig) {
    agent.configure({
      mediaPerception: createLlmMediaPerceptionPort({
        runtime: model.runtime,
        config: perceptionConfig,
        resilience: definition.agentConfig?.providerResilience,
        timers: clock,
      }),
    });
  }
  const host = asPrivate(agent);
  if (imageAssets) agent.configure({ imageAssets });
  const { sessionSystem, contextSystem } = host;
  if (!sessionSystem || !contextSystem) throw new Error('ZhinAgent did not compose its session/context systems');
  const engine = createFullAgentTurnEngine({
    host,
    core: new AgentCore(DEFAULT_AGENT_CORE_CONFIG, createDefaultAgentCoreDeps()),
    sessionSystem,
    contextSystem,
  });

  const executedTools: EvalToolInvocation[] = [];
  const rawToolOutputs: string[] = [];
  const outbound: string[] = [];
  const approvalRequests: string[] = [];
  const approvalQuestions: string[] = [];
  const events: TurnEvent[] = [];
  const terminals: TurnTerminalEvent[] = [];
  const traces: TurnTrace[] = [];
  const tools = [
    ...(definition.tools ?? []).map((tool) => toCapability(tool, executedTools, rawToolOutputs)),
    ...await nativeCapabilities(
      definition.nativeTools ?? [], definition.bashOutput ?? '', semanticMemory, executedTools, rawToolOutputs,
    ),
  ];
  const approval = createApprovalPort(definition.approval ?? 'approve', approvalRequests, approvalQuestions);

  const inbound = Array.isArray(definition.inbound) ? definition.inbound : [definition.inbound];
  for (const [index, message] of (inbound as readonly EvalInboundMessage[]).entries()) {
    const trace = createTurnTrace(definition, message, index);
    const releaseTrace = registerTurnTrace(trace);
    const { turn, tools: turnTools } = buildTurn(definition, message, index, tools, approval, outbound, workspace, trace);
    const context: AgentTurnExecutionContext = {
      turn,
      capabilities: {
        generation: 1,
        owner: rootPluginId(),
        tools: turnTools,
        skills: evalSkills(definition),
        agents: [],
        mcp: [],
        promptSections: promptSections(definition),
      },
      toolCapabilities: turnTools,
      tools: new TurnToolRuntime(turn, turnTools),
      selection: {
        binding: { name: 'zhin', providerAlias: model.providerAlias, model: model.modelId, mcpServers: [] },
        mcpServers: [],
      },
    };
    try {
      // Same path as AgentRuntime: the journal is the single source and
      // `events` is the journal-derived feed (includes authority tool events).
      await executeAgentTurn(turn, () => engine.run(context), (event) => {
        events.push(event);
        if (isTurnTerminalEvent(event)) terminals.push(event);
      });
    } finally {
      releaseTrace();
      trace.finalize();
      traces.push(trace.snapshot());
    }
  }

  return {
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
    extraModelRequests: model.exhaustedRequests(),
    unofferedToolCalls: model.unofferedToolCalls,
    modelMismatches: model.modelMismatches,
    unexpectedlyOfferedToolCalls: model.unexpectedlyOfferedToolCalls,
    traces,
  };
}

function buildTurn(
  definition: EvalCase,
  message: EvalInboundMessage,
  index: number,
  tools: readonly ToolCapability[],
  approval: ApprovalOutcomePort | undefined,
  outbound: string[],
  workspace: string | undefined,
  trace: TurnTraceCollector,
) {
  const scope = message.scope ?? 'private';
  const sender = message.sender ?? { id: 'eval-user', roles: ['user'] };
  const roles = [...(sender.roles ?? ['user'])];
  const sceneId = scope === 'group' ? 'eval-group' : sender.id;
  const sessionKey = sessionKeyFor(message);
  const requestedPolicy: TurnPolicyContext = message.policy ?? defaultPolicy(roles, workspace, message.shell === true);
  const origin = { kind: 'im', platform: PLATFORM, endpoint: ENDPOINT, scope, sceneId } as const;
  // Same #726 trust rule AgentRuntime applies before a Turn starts.
  const trust = applyTurnTrust({ origin, principal: { roles }, policy: requestedPolicy }, tools);
  const policy = trust.policy;
  const turnTools = trust.tools;
  const turnId = `${definition.id}:turn-${index + 1}`;
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
    },
    session: { key: sessionKey },
    policy,
    capabilities: {
      tools: turnTools.map((tool) => tool.name),
      skills: evalSkills(definition).map((skill) => skill.qualifiedName),
    },
    signal: new AbortController().signal,
    ports: {
      journal: createJournalFeed(createTracingJournal({ append: async () => undefined }, trace), { turnId }),
      reply: {
        send: async (output) => {
          const text = renderAgentOutput(output);
          outbound.push(text);
          return { status: 'sent' as const };
        },
      },
      ...(approval ? { approval } : {}),
      ...(message.backgroundEvents?.length ? { conversationContext: backgroundContext(message.backgroundEvents) } : {}),
    },
  });
  return { turn, tools: turnTools };
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
      roles: [...(sender.roles ?? ['user'])],
      trustLevel: resolveTurnTrustLevel({
        origin: { kind: 'im', scope: message.scope ?? 'private' },
        principal: { roles: sender.roles ?? ['user'] },
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
): Promise<ToolCapability[]> {
  if (names.length === 0) return [];
  const owner = rootPluginId();
  const bash = new NativeBashToolFeature({ execute: async () => ({ stdout: bashOutput, stderr: '' }) });
  const memoryFeatures = semanticMemory ? createNativeSemanticMemoryToolFeatures(semanticMemory) : [];
  const web = createNativeWebToolFeatures({
    request: async (url) => { throw new Error(`eval web transport never reaches the network (${url.href})`); },
  });
  const features = [bash, ...createNativeFileToolFeatures(), ...memoryFeatures, ...web]
    .filter((feature) => names.includes(feature.name as EvalNativeTool));
  const slots = features.map((feature) => createCapabilitySlot({
    owner,
    feature: feature.feature,
    localName: feature.name,
    source: `/builtin/${feature.name}`,
    definition: feature.definition,
  }));
  const index = new ToolIndex(slots, nativeSnapshot(slots));
  return index.list().map((descriptor) => ({
    ...descriptor,
    execute: (async (input: unknown, invocation: Parameters<ToolCapability['execute']>[1]) => {
      executed.push({ name: descriptor.name, args: (input ?? {}) as Record<string, unknown> });
      const result = await index.execute(owner, descriptor.name, input, invocation as never);
      rawOutputs.push(typeof result === 'string' ? result : JSON.stringify(result));
      return result;
    }) as ToolCapability['execute'],
  }));
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
