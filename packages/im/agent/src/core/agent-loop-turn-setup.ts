import { providerModelSupports } from '@zhin.js/ai/provider';
import { z } from 'zod';
import { formatCompact, truncatePreview, getLogger } from '@zhin.js/logger';
import { approvalPolicySnapshot, findStaleDenials, formatPolicyChangedNote } from '../security/approval-policy-fingerprint.js';
import {
  createPromptContextBlock,
  assistantText,
  createUserMessage,
  agentToolsToLlmTools,
  isProviderFailureMessage,
  type AgentTool,
  type Usage,
  type AgentMessage,
  type AssistantMessage,
} from '@zhin.js/ai';
import { ReplyStreamRun } from './reply-stream-run.js';
import { structuredReplyInstruction, structuredReplySchema } from '../outbound/structured-reply.js';
import { applyExecPolicyToTools } from '../security/exec-policy.js';
import { iterationSceneOf, resolveModelHarness, resolveTurnMaxIterations } from '../config/model-harness-runtime.js';
import {
  appendScene,
  appendStable,
  buildAgentPathSystemPromptParts,
  buildChatPathSystemPromptParts,
  describeAgentPathPromptSections,
  joinSystemPrompt,
} from '../prompt/assembly.js';
import { logPromptComposition } from '../internal/prompt-trace.js';
import { planToolRun } from '../tool/runtime.js';
import { unwrapJsonStringLayers } from './text-sanitize.js';
import { chatFailureKindOf, chatFailureLine, type ChatFailureOptions } from '../outbound/chat-failure.js';
import { buildLlmToolsForProvider } from '../tool/deferred-resolution.js';
import { DEFERRED_META_TOOL_NAMES, type ToolCatalogItem } from '../tool-catalog/types.js';
import { resolveDeferredApiTools, residentToolNames } from '../tool-catalog/tool-catalog.js';
import type { TurnEvent } from '../event/turn-event.js';
import { scenePromptPartsForTurn } from '../context/turn-envelope.js';
import { appendRuntimeContext } from '../context/turn-user-message.js';
import { ExecutableToolRegistry } from '../tool/executable-tool-registry.js';
import { withoutForbiddenShell } from '../plugin-runtime/native-bash-tool.js';
import { NETWORK_DISABLED_PROMPT_NOTE, NETWORK_TOOL_NAMES, withoutForbiddenNetwork } from '../security/network-authority.js';
import {
  DEFAULT_EXPLORATION_BUDGET,
  EXPLORATION_GUIDANCE,
  ExplorationBudget,
  SpinDetector,
} from './exploration-budget.js';
import { noteTurnTrace } from '../trace/turn-trace-registry.js';
import { scopeBootstrapText, bootstrapSceneFromTurn } from '../bootstrap-scope.js';
import { buildContextBudgetReport } from '../trace/context-budget.js';
import {
  historyWindowTrackerFor,
  historySceneFromTurn,
  resolveHistoryTokens,
  resolveHistoryMaxMessages,
} from '../context/history-window.js';
import { renderDeferredToolIndex, toolIndexGroup } from '../skill/capability-catalog.js';
import type { PromptSectionDebugInfo } from '../prompt/system-prompt.js';
import {
  traceTurnId,
  type AgentLoopTurnInput,
} from './agent-core-ports.js';

const logger = getLogger('ZhinAgent:AgentLoopTurn');

/** 入库前解开模型误包的 JSON 字符串，避免下一轮历史继续叠转义。 */
export function normalizeAssistantMessageText(assistant: AssistantMessage): void {
  for (const block of assistant.content) {
    if (block.type === 'text' && block.text) {
      block.text = unwrapJsonStringLayers(block.text);
    }
  }
}

export function resolveAssistantReplyText(assistant: AssistantMessage, chat?: ChatFailureOptions): string {
  normalizeAssistantMessageText(assistant);
  const text = assistantText(assistant);
  if (text.trim()) return text;
  // In a chat the failure is said like a member would say it; operators read the logs.
  if (assistant.errorMessage && chat) return chatFailureLine(chatFailureKindOf(assistant.errorMessage), chat);
  if (assistant.errorMessage && isProviderFailureMessage(assistant.errorMessage)) {
    return `${assistant.errorMessage}。`;
  }
  if (assistant.errorMessage) {
    return `模型调用失败：${assistant.errorMessage}。请检查 API 密钥与网络后重试。`;
  }
  return text;
}

export function logAssistantIterationFailure(
  assistant: AssistantMessage,
  modelId: string,
  sessionId: string,
): void {
  if (assistant.stopReason !== 'error' || !assistant.errorMessage) return;
  logger.warn(formatCompact({
    op: 'llm_error',
    session: sessionId,
    model: modelId,
    error: truncatePreview(assistant.errorMessage, 500),
  }));
}

export function turnEndFromLegacyUsage(reply: string, usage: Usage): TurnEvent {
  return {
    type: 'turn_end',
    output: reply.trim() ? [{ type: 'text', content: reply }] : [],
    usage: {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    },
  };
}

export async function collectAgentLoopTurnRun<R>(
  gen: AsyncGenerator<TurnEvent, R>,
  onTurnEvent?: (event: TurnEvent) => void,
): Promise<R> {
  while (true) {
    const step = await gen.next();
    if (step.done) return step.value;
    onTurnEvent?.(step.value);
  }
}

/** Catalog tools whose schema is not sent on this request (reachable via load_tool / discover). */
export function deferredCatalogTools(catalog: readonly ToolCatalogItem[], loaded: readonly AgentTool[]): ToolCatalogItem[] {
  const loadedNames = new Set(loaded.map((tool) => tool.name));
  return catalog.filter((item) => item.source !== 'meta' && !loadedNames.has(item.name));
}

export async function prepareAgentLoopTurnSetup(
  input: AgentLoopTurnInput,
  loadedMessages: AgentMessage[],
) {
  const { host, sessionId, personaEnhanced, modelId } = input;

  // Bash and network tools are only offered when this turn's policy can
  // actually use them, so the model never burns a step on a tool that is
  // guaranteed to fail. Filtering the catalog also keeps load_tool /
  // auto-load from re-adding them.
  const turnPolicy = input.turnContext.policy;
  const allTools = withoutForbiddenNetwork(turnPolicy, withoutForbiddenShell(turnPolicy, input.allTools));
  const resolvedTools = withoutForbiddenNetwork(turnPolicy, withoutForbiddenShell(turnPolicy, input.resolvedTools));
  const networkWithheld = [...input.allTools, ...input.resolvedTools, ...(input.toolCatalog ?? [])]
    .some(tool => NETWORK_TOOL_NAMES.has(tool.name)) && !allTools.some(tool => NETWORK_TOOL_NAMES.has(tool.name));

  const providerAlias = host.getTurnExecution().binding.account.id;
  const llmModel = host.getTurnExecution().model;
  const persistentConversation = input.conversationPersistence !== 'none';
  let promptMessages = input.initialMessages?.length
    ? input.initialMessages
    : [createUserMessage(input.rawContent)];

  // ADR 0043 §2: the model sees a token-bounded window of the stored history; storage and
  // compaction keep working on the full list.
  const historyWindow = {
    budget: resolveHistoryTokens(host.config.contextHistory?.tokens, historySceneFromTurn(input.turnContext)),
    maxMessages: resolveHistoryMaxMessages(host.config.contextHistory?.maxMessages),
  };
  const historyTracker = historyWindowTrackerFor(host);
  const windowed = persistentConversation
    ? historyTracker.select(sessionId, [...loadedMessages, ...promptMessages], historyWindow)
    : undefined;
  const historyView = windowed ? windowed.messages.slice(0, windowed.messages.length - promptMessages.length) : loadedMessages;

  const directTools = input.toolLoading === 'direct';
  const hasTools = providerModelSupports({ model: host.getTurnExecution().binding.model, requirements: { toolCalling: true } })
    && (directTools ? resolvedTools.length > 0 : allTools.length > 0);
  const toolRun = hasTools && !directTools
    ? await planToolRun(resolvedTools, host.config.preExecTimeout)
    : { mode: 'agent' as const, preExecution: { tools: [], data: '' } };

  const preData = toolRun.preExecution.data;
  // IM conversations get a message contract. Detached/programmatic turns keep
  // their text/custom-schema contract and never inherit the IM preset.
  // ai.agent.outputSchema: true / 'segments' → zhin message contract; an object → caller's own schema.
  const configuredSchema = host.config.outputSchema ?? 'segments';
  const messagePreset = configuredSchema === true || configuredSchema === 'segments';
  const imReply = messagePreset && input.turnContext.origin.kind === 'im'
    && input.conversationPersistence !== 'none';
  const replyPhases = imReply ? input.replyPhases : undefined;
  const initialReplyPhase = replyPhases?.open();
  const initialReplyRun = imReply && (initialReplyPhase?.stream ?? input.replyStream)
    ? new ReplyStreamRun((initialReplyPhase?.stream ?? input.replyStream)!, input.replySegments, input.messageAliases)
    : undefined;
  // This is a phase-transition marker, never a delegated or side-effecting capability.
  const prepareReply = !!initialReplyRun && hasTools
    && ![...allTools, ...resolvedTools, ...(input.toolCatalog ?? [])].some(tool => tool.name === 'prepare_reply');
  type LlmToolsList = ReturnType<typeof agentToolsToLlmTools>;
  const withReplyTransition = (tools: LlmToolsList): LlmToolsList => prepareReply ? [...tools, {
    name: 'prepare_reply',
    description: 'When all work and tools are finished, call this alone to enter the final public answer. No tools are available afterwards.',
    parameters: z.object({}).strict(),
  }] : tools;
  const chatFailure: ChatFailureOptions | undefined = input.turnContext.origin.kind === 'im'
    ? { master: input.turnContext.principal.roles.includes('owner'), locale: input.turnContext.input?.locale }
    : undefined;
  const outputSchema = imReply ? structuredReplySchema(input.replySegments)
    : messagePreset || !configuredSchema ? undefined : configuredSchema;
  const turnShellPolicy = input.turnContext.policy?.shell;
  const execPolicyConfig = turnShellPolicy
    ? {
        ...host.config,
        ...(turnShellPolicy.security ? { execSecurity: turnShellPolicy.security } : {}),
        ...(turnShellPolicy.execPreset ? { execPreset: turnShellPolicy.execPreset } : {}),
        ...(turnShellPolicy.approvalMode ? { execApprovalMode: turnShellPolicy.approvalMode } : {}),
      }
    : host.config;
  let promptParts = hasTools || input.promptProfile.kind === 'schedule'
    ? await buildAgentPathSystemPromptParts(host, {
        profile: input.promptProfile,
        turn: input.turnContext,
        content: input.rawContent,
        sessionId,
        personaEnhanced,
        deferredStats: input.deferredStats,
        modelSdk: llmModel.promptFamily,
        runtime: input.promptRuntime,
      })
    : buildChatPathSystemPromptParts(host, personaEnhanced, input.promptProfile, input.promptRuntime);
  const proseSystemPrompt = joinSystemPrompt(promptParts).text;
  // ADR 0042 §1: stable = instance/model/platform text, byte-identical across sessions and scenes;
  // the tail (scene line, per-turn notes, pre-fetched data) follows the cache breakpoint.
  if (imReply) promptParts = appendStable(promptParts, structuredReplyInstruction(input.replySegments));
  if (prepareReply) promptParts = appendStable(promptParts,
    'When ready to publish your final answer, call prepare_reply by itself. Then provide the final structured reply without further tools. Tool-phase text is not published.');
  let systemPrompt = joinSystemPrompt(promptParts).text;

  const agentTools = hasTools
    ? turnShellPolicy
      ? resolvedTools
      : applyExecPolicyToTools(execPolicyConfig, resolvedTools, {
          approvalMode: execPolicyConfig.execApprovalMode,
        })
    : [];

  const deferredController = directTools ? undefined : input.deferredController;
  const catalog = directTools ? [] : withoutForbiddenNetwork(turnPolicy, withoutForbiddenShell(turnPolicy, input.toolCatalog ?? []));
  if (!directTools && hasTools && (!deferredController || catalog.length === 0)) {
    throw new Error('Deferred tool loading requires a turn-owned controller and catalog');
  }

  // The meta tools plus every catalog item the capability plan pinned (scene tier, config names,
  // platform tools, `alwaysLoaded` plugin tools). Config names alone would re-add tier-excluded tools.
  const turnResidentTools = () => residentToolNames(catalog, DEFERRED_META_TOOL_NAMES);
  const refreshResolvedTools = () => {
    if (directTools) return resolvedTools;
    const alwaysLoaded = turnResidentTools();
    const loaded = deferredController!.loadedToolNames();
    return resolveDeferredApiTools(catalog, alwaysLoaded, loaded);
  };

  let promptSections: PromptSectionDebugInfo[] = [];
  if (hasTools) {
    const sections = input.promptProfile.kind === 'interactive'
      ? await describeAgentPathPromptSections(host, {
          turn: input.turnContext,
          content: input.rawContent,
          sessionId,
          deferredStats: input.deferredStats,
          modelSdk: llmModel.promptFamily,
          runtime: input.promptRuntime,
        })
      : [];
    promptSections = sections;
    logPromptComposition({
      config: host.promptTraceConfig,
      sessionId,
      label: 'orchestrator',
      systemPrompt,
      sections,
      historyMessages: historyView,
      tools: agentTools,
      userPreview: input.rawContent,
    });
  } else {
    logPromptComposition({
      config: host.promptTraceConfig,
      sessionId,
      label: 'chat',
      systemPrompt,
      historyMessages: historyView,
      tools: [],
      userPreview: input.rawContent,
    });
  }

  const harnessBinding = host.getTurnExecution().binding;
  const harness = resolveModelHarness({ driver: harnessBinding.service.driver, serviceId: harnessBinding.service.id, modelId, config: host.config.modelHarness });
  const maxIterations = hasTools
    ? (input.maxIterations ?? resolveTurnMaxIterations({
        driver: harnessBinding.service.driver,
        serviceId: harnessBinding.service.id,
        modelId,
        modelHarness: host.config.modelHarness,
        scene: iterationSceneOf(input.turnContext),
        configured: host.config.maxIterations,
      }))
    : 1;
  const explorationBudget = hasTools && !input.interactiveRun
    ? new ExplorationBudget(harness.explorationBudget ?? DEFAULT_EXPLORATION_BUDGET)
    : undefined;
  const spinDetector = hasTools && harness.explorationBudget !== 0 ? new SpinDetector() : undefined;
  if (hasTools && harness.explorationGuidance) promptParts = appendStable(promptParts, EXPLORATION_GUIDANCE);
  // Prompt-cache layout: everything that varies by turn or sender (observed scene state, capability
  // availability, deferred tool index, pre-fetched data, network note) rides in the runtime-context
  // tail of the current user message, after the body. A change there no longer invalidates the
  // cached history prefix. Only the bound conversation identity belongs in the session-stable tail.
  const runtimeTail: import('@zhin.js/ai').TextContentBlock[] = [];
  const scene = scenePromptPartsForTurn(input.turnContext);
  if (scene) promptParts = appendScene(promptParts, scene.identity);
  if (scene?.state) runtimeTail.push(createPromptContextBlock('scene', scene.state));
  const capabilityTail = input.promptRuntime?.capabilityTail?.trim();
  if (capabilityTail) runtimeTail.push(createPromptContextBlock('turn-capabilities', capabilityTail));
  if (hasTools && !directTools) {
    const toolIndex = renderDeferredToolIndex(deferredCatalogTools(catalog, agentTools)
      .map((item) => ({ name: item.name, description: item.brief, group: toolIndexGroup(item) })));
    if (toolIndex) runtimeTail.push(createPromptContextBlock('deferred-tools', toolIndex));
  }
  if (preData) runtimeTail.push(createPromptContextBlock('pre-fetched-data', `Pre-fetched data:\n${preData}`));
  if (networkWithheld) runtimeTail.push({ type: 'text', text: NETWORK_DISABLED_PROMPT_NOTE });
  // #1250: denials decided under an earlier approval policy no longer speak for the current one.
  if (hasTools) {
    const policy = approvalPolicySnapshot(host.config);
    const stale = findStaleDenials(historyView, policy);
    if (stale.length) runtimeTail.push(createPromptContextBlock('approval-policy-change', formatPolicyChangedNote(stale, policy)));
  }
  promptMessages = appendRuntimeContext(promptMessages, runtimeTail);
  const composedPrompt = joinSystemPrompt(promptParts);
  systemPrompt = composedPrompt.text;
  const systemPromptCacheBreakpoint = composedPrompt.cacheBreakpoint;

  const executableTools = new ExecutableToolRegistry(agentTools);
  let initialLlmTools = directTools
    ? agentToolsToLlmTools(agentTools)
    : buildLlmToolsForProvider({
        nativeDeferredTools: llmModel.nativeDeferredTools === true, catalog, apiTools: agentTools,
        alwaysLoaded: turnResidentTools(), sessionLoadedNames: deferredController?.loadedToolNames() ?? [],
      });
  initialLlmTools = withReplyTransition(initialLlmTools);
  if (hasTools) {
    noteTurnTrace(traceTurnId(input.turnContext), {
      kind: 'context_budget',
      report: buildContextBudgetReport({
        systemPrompt,
        outputSchema,
        sections: promptSections,
        bootstrapContext: input.promptRuntime?.bootstrapContext,
        bootstrapSkipped: scopeBootstrapText(
          input.promptRuntime?.bootstrapContext ?? '',
          bootstrapSceneFromTurn(input.turnContext),
          { contextFiles: input.promptRuntime?.contextFiles },
        ).skipped,
        activeSkillsContext: input.promptRuntime?.activeSkillsContext,
        loadedTools: agentTools,
        deferredToolCount: deferredCatalogTools(catalog, agentTools).length,
        historyMessages: historyView,
        userMessages: promptMessages,
      }),
    });
  }

  return {
    providerAlias,
    llmModel,
    persistentConversation,
    promptMessages,
    historyWindow,
    historyTracker,
    directTools,
    hasTools,
    imReply,
    replyPhases,
    initialReplyPhase,
    initialReplyRun,
    prepareReply,
    withReplyTransition,
    chatFailure,
    outputSchema,
    turnShellPolicy,
    execPolicyConfig,
    proseSystemPrompt,
    systemPrompt,
    systemPromptCacheBreakpoint,
    agentTools,
    deferredController,
    catalog,
    turnResidentTools,
    refreshResolvedTools,
    harness,
    maxIterations,
    explorationBudget,
    spinDetector,
    executableTools,
    initialLlmTools,
  };
}
