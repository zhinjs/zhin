/**
 * DeferredWorkerRunner — 同步 Worker 子 Agent，在隔离上下文中执行 deferred 工具任务。
 */
import { Logger } from '@zhin.js/core';
import { formatCompact, formatCompactUsage, truncatePreview } from '@zhin.js/logger';
import type { AIProvider, AgentTool } from '@zhin.js/core';
import { createAgent } from '@zhin.js/ai';
import {
  isOmittedToolSummary,
  sanitizeToolResult,
  stripHallucinatedToolCalls,
} from '@zhin.js/ai';
import type { AgentResult } from '@zhin.js/ai';
import { stripThinkBlocks } from './zhin-agent/text-sanitize.js';
import { selectDeferredToolsForWorker } from './deferred-worker-tool-load.js';
import {
  resolveAgentPromptMarkdown,
  resolveDeferredToolsForPlatform,
} from './agent-prompt/index.js';
import type { AgentPromptBuildContext } from '@zhin.js/core';
import type { ModelRegistry } from '@zhin.js/ai';
import type { ZhinAgentConfig, ExecApprovalMode } from './zhin-agent/config.js';
import { resolveWorkerSlowToolTimeout } from './zhin-agent/config.js';
import { applyExecPolicyToTools } from './security/exec-policy.js';
import { RESERVED_TOOL_NAMES, RESERVED_TOOL_NAME_PREFIXES } from './reserved-tools.js';
import { resolveContextBudget } from './zhin-agent/context-budget.js';
import { createOwnerOrchestratedToolResultTransform } from './orchestrator/owner-confirm-orchestration.js';
import { runWithDirectAgentExecution } from './security/bash-tool-context.js';
import type { ToolContext } from '@zhin.js/core';
import { DEFAULT_TOOL_SEARCH_ORCHESTRATOR_TOOLS } from './zhin-agent/config.js';

const logger = new Logger(null, 'DeferredWorker');
const ORCHESTRATOR_TOOL_SET = new Set<string>(DEFAULT_TOOL_SEARCH_ORCHESTRATOR_TOOLS);

/** 回传给主 Agent 的摘要最大字符数 */
export const DEFAULT_WORKER_SUMMARY_MAX_CHARS = 1500;

export interface DeferredWorkerRunOptions {
  goal: string;
  toolQuery?: string;
  deferredCatalog: AgentTool[];
  workerBaseTools: AgentTool[];
  allToolsByName: Map<string, AgentTool>;
  origin: ToolContext;
  maxToolResults: number;
  maxIterations?: number;
  execPolicyConfig?: Required<ZhinAgentConfig>;
  execApprovalMode?: ExecApprovalMode;
  modelRegistry?: ModelRegistry | null;
  provider: AIProvider;
  summaryMaxChars?: number;
  onEvent?: (event: DeferredWorkerLifecycleEvent) => void | Promise<void>;
}

export interface DeferredWorkerLifecycleEvent {
  phase: 'start' | 'finish';
  goal: string;
  toolQuery?: string;
  status?: 'ok' | 'partial' | 'error';
  loadedToolNames?: string[];
  iterations?: number;
  error?: string;
}

export interface DeferredWorkerResult {
  summary: string;
  loadedToolNames: string[];
  iterations: number;
  status: 'ok' | 'partial' | 'error';
}

export class DeferredWorkerRunner {
  async runSync(options: DeferredWorkerRunOptions): Promise<DeferredWorkerResult> {
    const {
      goal,
      toolQuery,
      deferredCatalog,
      workerBaseTools,
      allToolsByName,
      origin,
      maxToolResults,
      provider,
      execPolicyConfig,
      execApprovalMode,
      modelRegistry,
      summaryMaxChars = DEFAULT_WORKER_SUMMARY_MAX_CHARS,
      onEvent,
    } = options;

    const query = (toolQuery?.trim() || goal).trim();
    const promptCtx: AgentPromptBuildContext = {
      slot: 'deferred_worker',
      toolContext: origin,
      deferred: { goal, toolQuery: query },
    };
    const loaded = resolveDeferredToolsForPlatform(
      promptCtx,
      query,
      goal,
      deferredCatalog,
      maxToolResults,
      selectDeferredToolsForWorker,
    );

    const workerTools: AgentTool[] = [];
    const seen = new Set<string>();
    const addTool = (tool: AgentTool | undefined) => {
      if (!tool || seen.has(tool.name) || ORCHESTRATOR_TOOL_SET.has(tool.name)) return;
      workerTools.push(tool);
      seen.add(tool.name);
    };

    for (const t of workerBaseTools) {
      addTool(allToolsByName.get(t.name) ?? t);
    }
    for (const t of loaded) addTool(t);

    const loadedToolNames = workerTools.map(t => t.name);
    if (loadedToolNames.length === 0) {
      logger.info(formatCompact( {
        worker: 'delegated',
        ok: false,
        goal: truncatePreview(goal, 300),
        tool_query: truncatePreview(query, 120),
        error: 'no_tools_matched',
      }));
      return {
        summary: JSON.stringify({
          status: 'error',
          error: 'No deferred tools matched the query',
          tool_query: query,
          hint: 'Try a more specific tool_query or broaden the goal',
        }),
        loadedToolNames: [],
        iterations: 0,
        status: 'error',
      };
    }

    let tools = workerTools;
    if (execPolicyConfig) {
      tools = applyExecPolicyToTools(execPolicyConfig, tools, {
        approvalMode: execApprovalMode ?? execPolicyConfig.workerExecApprovalMode,
      });
    }
    if (execPolicyConfig) {
      const slowTimeout = resolveWorkerSlowToolTimeout(execPolicyConfig);
      tools = tools.map((t) => ({
        ...t,
        timeout: t.timeout ?? (t.name.startsWith('mcp_') ? slowTimeout : 60_000),
      }));
    }

    const model = provider.models[0];
    const contextBudget = execPolicyConfig
      ? resolveContextBudget({
          config: execPolicyConfig,
          provider,
          modelRegistry: modelRegistry ?? null,
          model,
        })
      : null;

    const platformBody = await resolveAgentPromptMarkdown({
      ctx: promptCtx,
      config: execPolicyConfig,
    });
    const platformBlock = platformBody.trim()
      ? `\n\n## Platform\n${platformBody.trim()}`
      : '';

    const systemPrompt = `# Deferred Task Worker

You execute a single delegated task using the tools provided. Reply with a concise factual summary when done.

## Task
${goal}${platformBlock}

## Rules
- Use tools to complete the task; do not describe steps without acting.
- Shell approval follows Worker/Task execApprovalMode configuration.
- If a tool fails, try an alternative once, then report honestly.
- Final answer: plain language summary for the orchestrator (no tool call syntax).`;

    const maxIterations = options.maxIterations ?? execPolicyConfig?.maxSubagentIterations ?? 15;

    logger.info(formatCompact( {
      worker: 'delegated',
      goal: truncatePreview(goal, 300),
      tool_query: query !== goal ? truncatePreview(query, 120) : undefined,
      tools: loadedToolNames.join(','),
    }));
    await onEvent?.({
      phase: 'start',
      goal,
      toolQuery,
      loadedToolNames,
    });

    const agent = createAgent(provider, {
      model,
      systemPrompt,
      tools,
      maxIterations,
      turnTimeout: execPolicyConfig?.timeout ?? 60_000,
      // Worker 须能注册 bash/read_file 等内置名；仅保留编排类元工具不可被插件覆盖
      reservedToolNames: [...ORCHESTRATOR_TOOL_SET],
      reservedToolNamePrefixes: RESERVED_TOOL_NAME_PREFIXES,
      contextWindow: contextBudget?.contextWindow ?? provider.contextWindow,
      forceMicroCompactEachTurn: true,
      transformToolResult: createOwnerOrchestratedToolResultTransform({
        toolContext: origin,
        disableHardOrchestration: true,
      }),
    });

    try {
      const result = await runWithDirectAgentExecution(origin, () => agent.run(goal));
      const hitMaxIter = result.iterations >= maxIterations;
      const summary = buildWorkerSummary(result, summaryMaxChars, hitMaxIter);
      logger.info(formatCompact( {
        worker: 'done',
        ok: true,
        partial: hitMaxIter || undefined,
        iter: result.iterations,
        tools: loadedToolNames.join(','),
        usage: formatCompactUsage(result.usage),
        summary: truncatePreview(summary, 480),
      }));
      await onEvent?.({
        phase: 'finish',
        goal,
        toolQuery,
        loadedToolNames,
        iterations: result.iterations,
        status: hitMaxIter ? 'partial' : 'ok',
      });
      return {
        summary: JSON.stringify({
          status: hitMaxIter ? 'partial' : 'ok',
          loaded_tools: loadedToolNames,
          iterations: result.iterations,
          summary,
        }),
        loadedToolNames,
        iterations: result.iterations,
        status: hitMaxIter ? 'partial' : 'ok',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(formatCompact( {
        worker: 'done',
        ok: false,
        tools: loadedToolNames.join(','),
        error: truncatePreview(errorMsg),
      }));
      await onEvent?.({
        phase: 'finish',
        goal,
        toolQuery,
        loadedToolNames,
        status: 'error',
        error: errorMsg,
      });
      return {
        summary: JSON.stringify({
          status: 'error',
          loaded_tools: loadedToolNames,
          error: errorMsg,
        }),
        loadedToolNames,
        iterations: 0,
        status: 'error',
      };
    } finally {
      agent.dispose();
    }
  }
}

function buildWorkerSummary(
  result: AgentResult,
  maxChars: number,
  hitMaxIter: boolean,
): string {
  const raw = result.content?.trim() || '';
  let cleaned = sanitizeToolResult(
    stripHallucinatedToolCalls(stripThinkBlocks(raw)),
    { maxChars },
  );
  if (isOmittedToolSummary(cleaned)) {
    cleaned = summarizeWorkerToolCalls(result.toolCalls, maxChars);
  }
  if (!cleaned) {
    cleaned = '子任务未生成可读摘要。';
  }
  if (hitMaxIter) {
    cleaned += '\n（已达 Worker 最大轮次，可能未完全完成；可拆成更小的子任务重试）';
  }
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars)}\n…[truncated]`;
}

function summarizeWorkerToolCalls(
  toolCalls: AgentResult['toolCalls'],
  maxChars: number,
): string {
  if (!toolCalls?.length) {
    return '子任务已执行但未留下工具结果，请缩小目标后重试。';
  }
  const parts: string[] = [];
  for (const tc of toolCalls.slice(-12)) {
    const raw =
      typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result);
    const block = sanitizeToolResult(raw, {
      maxChars: Math.min(900, maxChars),
    });
    if (block && !isOmittedToolSummary(block)) {
      parts.push(`${tc.tool}:\n${block}`);
    }
  }
  if (!parts.length) {
    return '子任务已调用工具，但结果无法整理成摘要；请缩小目标后重试。';
  }
  return parts.join('\n\n');
}
