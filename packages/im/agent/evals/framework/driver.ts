/**
 * Engine driver: assembles the smallest real host (ZhinAgent + AgentCore +
 * session/context systems) around the scripted model, builds a canonical
 * TurnIngress per inbound message and runs it through FullAgentTurnEngine.
 */
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { AgentCore } from '../../src/core/agent-core.js';
import { DEFAULT_AGENT_CORE_CONFIG, createDefaultAgentCoreDeps } from '../../src/core/compose-deps.js';
import { isTurnTerminalEvent, type TurnEvent, type TurnTerminalEvent } from '../../src/event/turn-event.js';
import { asPrivate } from '../../src/internal/as-private.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import type { AgentTurnExecutionContext } from '../../src/plugin-runtime/agent-runtime.js';
import { createFullAgentTurnEngine } from '../../src/plugin-runtime/full-agent-turn-engine.js';
import type { ApprovalOutcome, ApprovalOutcomePort } from '../../src/session/approval-port.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress, type ConversationContextPort, type TurnPolicyContext } from '../../src/turn/turn-ingress.js';
import { DEFAULT_DEFERRED_TOOLS_CONFIG } from '../../src/tool-catalog/types.js';
import { ZhinAgent } from '../../src/zhin-agent/index.js';
import type { EvalApprovalBehaviour, EvalCase, EvalInboundMessage, EvalTool } from './fixture.js';
import { createScriptedModel, type ScriptedModelRequest } from './scripted-model.js';

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
  /** Terminal event of each turn, in order. */
  readonly terminals: readonly TurnTerminalEvent[];
  readonly modelRequests: readonly ScriptedModelRequest[];
  readonly unusedScriptSteps: number;
  /** Model requests made after the script ran out. */
  readonly extraModelRequests: number;
  /** Scripted tool calls naming a tool the harness did not offer on that request. */
  readonly unofferedToolCalls: readonly string[];
}

const ENDPOINT = 'eval-bot';
const PLATFORM = 'eval';

export async function runEvalCase(definition: EvalCase): Promise<EvalRunRecord> {
  const model = createScriptedModel(definition.script);
  const toolNames = (definition.tools ?? []).map((tool) => tool.name);
  // Mocked tools are always loaded so scripts can call them without a
  // discover/load_tool round trip; the default always-loaded set is kept.
  const alwaysLoadedTools = [
    ...(definition.agentConfig?.deferredTools?.alwaysLoadedTools ?? DEFAULT_DEFERRED_TOOLS_CONFIG.alwaysLoadedTools),
    ...toolNames,
  ];
  const agent = new ZhinAgent(model.provider, {
    maxIterations: 6,
    toolExecution: 'sequential',
    ...definition.agentConfig,
    deferredTools: {
      ...definition.agentConfig?.deferredTools,
      alwaysLoadedTools,
    },
  }, undefined, model.runtime);
  agent.activeBinding = { name: 'zhin', providerAlias: model.providerAlias, model: model.modelId, mcpServers: [] };
  agent.markMemoryPersistenceReady();
  const host = asPrivate(agent);
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
  const events: TurnEvent[] = [];
  const terminals: TurnTerminalEvent[] = [];
  const tools = (definition.tools ?? []).map((tool) => toCapability(tool, executedTools, rawToolOutputs));
  const approval = createApprovalPort(definition.approval ?? 'approve', approvalRequests);

  const inbound = Array.isArray(definition.inbound) ? definition.inbound : [definition.inbound];
  for (const [index, message] of (inbound as readonly EvalInboundMessage[]).entries()) {
    const turn = buildTurn(definition, message, index, tools, approval, outbound);
    const context: AgentTurnExecutionContext = {
      turn,
      capabilities: { generation: 1, owner: rootPluginId(), tools, skills: [], agents: [], mcp: [], promptSections: [] },
      toolCapabilities: tools,
      tools: new TurnToolRuntime(turn, tools),
      selection: {
        binding: { name: 'zhin', providerAlias: model.providerAlias, model: model.modelId, mcpServers: [] },
        mcpServers: [],
      },
    };
    const stream = engine.run(context);
    while (true) {
      const step = await stream.next();
      if (step.done) {
        await step.value?.project();
        break;
      }
      events.push(step.value);
      if (isTurnTerminalEvent(step.value)) terminals.push(step.value);
    }
  }

  return {
    events,
    executedTools,
    attemptedTools: model.requests.flatMap((request) => request.toolCalls),
    outbound,
    rawToolOutputs,
    approvalRequests,
    terminals,
    modelRequests: model.requests,
    unusedScriptSteps: model.remainingSteps(),
    extraModelRequests: model.exhaustedRequests(),
    unofferedToolCalls: model.unofferedToolCalls,
  };
}

function buildTurn(
  definition: EvalCase,
  message: EvalInboundMessage,
  index: number,
  tools: readonly ToolCapability[],
  approval: ApprovalOutcomePort | undefined,
  outbound: string[],
) {
  const scope = message.scope ?? 'private';
  const sender = message.sender ?? { id: 'eval-user', roles: ['user'] };
  const roles = [...(sender.roles ?? ['user'])];
  const sceneId = scope === 'group' ? 'eval-group' : sender.id;
  const sessionKey = `im:${PLATFORM}:${ENDPOINT}:${scope}:${sceneId}`;
  const policy: TurnPolicyContext = message.policy ?? { permissions: roles, unattended: false };
  const turnId = `${definition.id}:turn-${index + 1}`;
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: turnId, turnId },
    origin: { kind: 'im', platform: PLATFORM, endpoint: ENDPOINT, scope, sceneId, messageId: `${turnId}:message` },
    principal: { subjectId: sender.id, ...(sender.name ? { displayName: sender.name } : {}), roles },
    input: { text: message.text },
    session: { key: sessionKey },
    policy,
    capabilities: { tools: tools.map((tool) => tool.name), skills: [] },
    signal: new AbortController().signal,
    ports: {
      journal: { append: async () => undefined },
      reply: {
        send: async (output) => {
          const text = output
            .map((element) => ('content' in element && typeof element.content === 'string' ? element.content : ''))
            .join('');
          outbound.push(text);
          return { status: 'sent' as const };
        },
      },
      ...(approval ? { approval } : {}),
      ...(message.backgroundEvents?.length ? { conversationContext: backgroundContext(message.backgroundEvents) } : {}),
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
    requiresApproval: tool.requiresApproval ?? 'never',
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

function createApprovalPort(behaviour: EvalApprovalBehaviour, requests: string[]): ApprovalOutcomePort | undefined {
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
      return outcome;
    },
  };
}
