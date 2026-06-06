/**
 * agentLoop turn runner (ADR 0009) — used when ContextRepository is wired.
 */

import { getPlugin, type Plugin } from '@zhin.js/core';
import { formatCompact, Logger } from '@zhin.js/logger';
import type { AgentTool, Usage } from '@zhin.js/ai';
import {
  agentLoop,
  agentContextFrom,
  assistantText,
  createUserMessage,
  getModel,
  convertLegacyTools,
  type AgentMessage,
  type ParsedToolCall,
  type AssistantMessage,
  type TokenUsage,
} from '@zhin.js/ai';
import { runWithBashToolContext } from '../security/bash-tool-context.js';
import { applyExecPolicyToTools } from '../security/exec-policy.js';
import { createOwnerOrchestratedToolResultTransform } from '../orchestrator/owner-confirm-orchestration.js';
import { resolveModelHarness } from './model-harness.js';
import { buildAgentPathSystemPrompt, buildChatPathSystemPrompt } from './prompt-assembly.js';
import { planToolRun } from './tool-runtime.js';
import { sanitizeAssistantReply } from './text-sanitize.js';
import { formatToolCallsForUser, type ToolCallRecord } from './tool-calls-user-format.js';
import { logPhase, usageLogFields } from './phase-trace.js';
import type { PromptTurnHooks } from './prompt-controller.js';
import type { ZhinAgentPrivate, OnChunkCallback, ToolContext } from './zhin-agent-private.js';

const logger = new Logger(null, 'ZhinAgent:AgentLoopTurn');

function tokenUsageToLegacy(usage: TokenUsage): Usage {
  return {
    prompt_tokens: usage.input,
    completion_tokens: usage.output,
    total_tokens: usage.totalTokens,
  };
}

function toolResultToAgentMessage(
  toolCall: ParsedToolCall,
  result: unknown,
  isError: boolean,
): AgentMessage {
  const text =
    typeof result === 'string'
      ? result
      : result == null
        ? ''
        : JSON.stringify(result);
  return {
    role: 'toolResult',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: 'text', text: text || (isError ? 'Error' : '') }],
    isError,
    timestamp: Date.now(),
  };
}

export interface AgentLoopTurnInput {
  host: ZhinAgentPrivate;
  sessionId: string;
  sessionUserContent: string;
  rawContent: string;
  context: ToolContext;
  contextForTools: ToolContext;
  allTools: AgentTool[];
  resolvedTools: AgentTool[];
  personaEnhanced: string;
  modelId: string;
  modelCandidates: string[];
  onChunk?: OnChunkCallback;
  initialMessages?: AgentMessage[];
  promptHooks?: PromptTurnHooks;
  signal?: AbortSignal;
  deferredStats?: string;
}

export interface AgentLoopTurnResult {
  reply: string;
  usage: Usage;
  path: 'chat' | 'agent' | 'multimodal';
  iterations: number;
  model: string;
  toolCalls: ToolCallRecord[];
}

export interface AgentLoopVisionTurnInput {
  host: ZhinAgentPrivate;
  sessionId: string;
  context: ToolContext;
  visionSystemPrompt: string;
  userMessages: AgentMessage[];
  modelCandidates: string[];
  onChunk?: OnChunkCallback;
  promptHooks?: PromptTurnHooks;
  signal?: AbortSignal;
}

export type AgentLoopVisionTurnResult = AgentLoopTurnResult & { path: 'multimodal' };

async function runAgentLoopVisionTurnOnce(
  input: AgentLoopVisionTurnInput & { modelId: string },
): Promise<AgentLoopVisionTurnResult> {
  const { host, sessionId, context, visionSystemPrompt, modelId, onChunk, promptHooks, signal } = input;
  const repo = host.contextRepository;
  const providerAlias = host.getTurnProvider().name;
  const llmModel = getModel(providerAlias, modelId);
  const loaded = await repo.loadContext(sessionId);
  const promptMessages = input.userMessages;

  let iterations = 0;
  let lastAssistantText = '';
  let lastUsage: TokenUsage | undefined;

  logPhase(host.phaseConfig, 'agent_loop.vision.start', sessionId, { model: modelId });

  const loopContext = agentContextFrom({
    systemPrompt: visionSystemPrompt,
    messages: loaded.messages,
    tools: [],
  });

  const loopConfig = {
    model: llmModel,
    maxIterations: 1,
    convertToLlm: (messages: AgentMessage[]) => messages,
    getSteeringMessages: promptHooks?.getSteeringMessages,
    getFollowUpMessages: promptHooks?.getFollowUpMessages,
  };

  for await (const event of agentLoop(promptMessages, loopContext, loopConfig, signal)) {
    if (event.type === 'turn_start') {
      iterations += 1;
    }
    if (event.type === 'message_update' && event.delta?.type === 'text_delta') {
      onChunk?.(event.delta.text, lastAssistantText + event.delta.text);
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const assistant = event.message as AssistantMessage;
      lastAssistantText = assistantText(assistant);
      lastUsage = assistant.usage;
      onChunk?.(lastAssistantText, lastAssistantText);
    }
    if (event.type === 'agent_end') {
      const userBatch = event.userMessages ?? promptMessages;
      await repo.appendMessages(sessionId, [...userBatch, ...event.messages]);
    }
  }

  const reply = sanitizeAssistantReply(lastAssistantText);
  if (!reply.trim()) {
    throw new Error('Empty vision model response');
  }

  logPhase(host.phaseConfig, 'agent_loop.vision.end', sessionId, {
    iterations,
    ...usageLogFields(lastUsage ? tokenUsageToLegacy(lastUsage) : undefined),
  });

  return {
    reply,
    usage: lastUsage ? tokenUsageToLegacy(lastUsage) : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    path: 'multimodal',
    iterations,
    model: modelId,
    toolCalls: [],
  };
}

export async function runAgentLoopVisionTurn(
  input: AgentLoopVisionTurnInput,
): Promise<AgentLoopVisionTurnResult> {
  const candidates = input.modelCandidates.filter(Boolean);
  if (candidates.length === 0) {
    throw new Error('No vision model candidates configured');
  }

  let lastError: Error | undefined;
  for (let i = 0; i < candidates.length; i++) {
    const modelId = candidates[i]!;
    try {
      return await runAgentLoopVisionTurnOnce({ ...input, modelId });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isLast = i === candidates.length - 1;
      if (isLast) break;
      logger.warn(formatCompact({
        mode: 'multimodal',
        fallback: `${modelId}→${candidates[i + 1]}`,
        error: lastError.message.slice(0, 120),
      }));
    }
  }
  throw lastError ?? new Error('All vision model candidates failed');
}

export async function runAgentLoopTextTurn(input: AgentLoopTurnInput): Promise<AgentLoopTurnResult> {
  const {
    host,
    sessionId,
    sessionUserContent,
    context,
    contextForTools,
    allTools,
    resolvedTools,
    personaEnhanced,
    modelId,
    onChunk,
    promptHooks,
    signal,
  } = input;

  const repo = host.contextRepository;

  const providerAlias = host.getTurnProvider().name;
  const llmModel = getModel(providerAlias, modelId);
  const loaded = await repo.loadContext(sessionId);
  const promptMessages = input.initialMessages?.length
    ? input.initialMessages
    : [createUserMessage(sessionUserContent)];

  const toolRun = allTools.length > 0
    ? await planToolRun(resolvedTools, host.config.preExecTimeout)
    : { mode: 'agent' as const, preExecution: { tools: [], data: '' } };

  const preData = toolRun.preExecution.data;
  const hasTools = allTools.length > 0;
  const systemPrompt = hasTools
    ? await buildAgentPathSystemPrompt(host, {
        content: input.rawContent,
        context: contextForTools,
        sessionId,
        personaEnhanced,
        preData,
        deferredStats: input.deferredStats,
      })
    : buildChatPathSystemPrompt(host, personaEnhanced, contextForTools);

  const agentTools = hasTools
    ? applyExecPolicyToTools(host.config, resolvedTools, {
        approvalMode: host.config.execApprovalMode,
      })
    : [];

  const harness = resolveModelHarness(host.getTurnProvider().name, modelId, host.config.modelHarness);
  const maxIterations = hasTools
    ? (harness.maxIterations ?? host.config.maxIterations)
    : 1;

  let orchestrationPlugin: Plugin | undefined = host.emitter.getHostPlugin() ?? undefined;
  if (!orchestrationPlugin) {
    try {
      orchestrationPlugin = getPlugin().root ?? getPlugin();
    } catch {
      logger.warn(formatCompact({ warn: 'no_host_plugin' }));
    }
  }

  const transformToolResult = createOwnerOrchestratedToolResultTransform({
    toolContext: contextForTools,
    disableHardOrchestration: false,
    plugin: orchestrationPlugin,
  });

  const legacyByName = new Map(agentTools.map((t) => [t.name, t]));
  const llmTools = convertLegacyTools(agentTools);
  const toolCalls: ToolCallRecord[] = [];
  let iterations = 0;
  let lastAssistantText = '';
  let lastUsage: TokenUsage | undefined;

  logPhase(host.phaseConfig, 'agent_loop.turn.start', sessionId, {
    model: modelId,
    maxIterations,
    toolCount: agentTools.length,
  });

  if (hasTools) {
    await host.emitter.dispatch('ai.agent.start', host.emitter.createPayload(sessionId, contextForTools, 'text', {
      path: 'agent',
      model: modelId,
    }));
  }

  const loopContext = agentContextFrom({
    systemPrompt,
    messages: loaded.messages,
    tools: llmTools,
  });

  const loopConfig = {
    model: llmModel,
    maxIterations,
    convertToLlm: (messages: AgentMessage[]) => messages,
    getSteeringMessages: promptHooks?.getSteeringMessages,
    getFollowUpMessages: promptHooks?.getFollowUpMessages,
    executeTool: async (toolCall: ParsedToolCall, _tools: typeof llmTools, toolSignal?: AbortSignal) => {
      const legacy = legacyByName.get(toolCall.name);
      if (!legacy) {
        return toolResultToAgentMessage(toolCall, `Unknown tool: ${toolCall.name}`, true);
      }
      try {
        const raw = await runWithBashToolContext(contextForTools, () =>
          legacy.execute(toolCall.arguments),
        );
        const rawText = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);
        const transformed = await transformToolResult({
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          args: toolCall.arguments,
          result: rawText,
        });
        const resultText = typeof transformed === 'string' ? transformed : String(transformed);
        toolCalls.push({ tool: toolCall.name, args: toolCall.arguments, result: resultText });
        host.emitter.emit('ai.tool.result', host.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          toolName: toolCall.name,
          result: resultText,
        }));
        return toolResultToAgentMessage(toolCall, resultText, false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolCalls.push({ tool: toolCall.name, args: toolCall.arguments, result: message });
        return toolResultToAgentMessage(toolCall, message, true);
      }
    },
    beforeToolCall: async ({ toolCall }: { toolCall: ParsedToolCall }) => {
      host.emitter.emit('ai.tool.call', host.emitter.createPayload(sessionId, contextForTools, 'text', {
        path: 'agent',
        toolName: toolCall.name,
        args: toolCall.arguments,
      }));
      return undefined;
    },
  };

  for await (const event of agentLoop(promptMessages, loopContext, loopConfig, signal)) {
    if (event.type === 'turn_start') {
      iterations += 1;
    }
    if (event.type === 'message_update' && event.delta?.type === 'text_delta') {
      onChunk?.(event.delta.text, lastAssistantText + event.delta.text);
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const assistant = event.message as AssistantMessage;
      lastAssistantText = assistantText(assistant);
      lastUsage = assistant.usage;
      onChunk?.(lastAssistantText, lastAssistantText);
    }
    if (event.type === 'agent_end') {
      const userBatch = event.userMessages ?? promptMessages;
      await repo.appendMessages(sessionId, [...userBatch, ...event.messages]);
    }
  }

  const reply = sanitizeAssistantReply(lastAssistantText, {
    toolSummary: formatToolCallsForUser(toolCalls),
  });

  const spawnedSubagent = toolCalls.some(tc => tc.tool === 'spawn_task');
  if (spawnedSubagent) {
    await host.getActiveTurnTracker()?.waitForPendingSubagents();
  }
  const delegatedOnly = spawnedSubagent
    && !toolCalls.some(tc => tc.tool === 'run_deferred_task')
    && !toolCalls.some(tc =>
      tc.tool === 'generate_image'
      && tc.result
      && typeof tc.result === 'object'
      && typeof (tc.result as Record<string, unknown>).image === 'string',
    );
  const finalReply = delegatedOnly ? '' : reply;

  if (hasTools) {
    await host.emitter.dispatch('ai.agent.finish', host.emitter.createPayload(sessionId, contextForTools, 'text', {
      path: 'agent',
      model: modelId,
      iterations,
    }));
  }

  logPhase(host.phaseConfig, 'agent_loop.turn.end', sessionId, {
    iterations,
    ...usageLogFields(lastUsage ? tokenUsageToLegacy(lastUsage) : undefined),
  });

  return {
    reply: finalReply,
    usage: lastUsage ? tokenUsageToLegacy(lastUsage) : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    path: hasTools ? 'agent' : 'chat',
    iterations,
    model: modelId,
    toolCalls,
  };
}
