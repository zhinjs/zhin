/**
 * DeferredWorkerRunner — 同步 Worker 子 Agent，在隔离上下文中执行 deferred 工具任务。
 */
import { Logger } from '@zhin.js/core';
import { formatCompact, formatCompactUsage, truncatePreview } from '@zhin.js/logger';
import type { AIProvider, AgentTool } from '@zhin.js/core';
import { createAgent } from '@zhin.js/ai';
import { selectDeferredToolsForWorker } from './deferred-worker-tool-load.js';
import {
  resolveAgentPromptMarkdown,
  resolveDeferredToolsForPlatform,
} from './agent-prompt/index.js';
import type { AgentPromptBuildContext } from '@zhin.js/core';
import type { ModelRegistry } from '@zhin.js/ai';
import type { ZhinAgentConfig } from './zhin-agent/config.js';
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
  modelRegistry?: ModelRegistry | null;
  provider: AIProvider;
  summaryMaxChars?: number;
}

export interface DeferredWorkerResult {
  summary: string;
  loadedToolNames: string[];
  iterations: number;
  status: 'ok' | 'error';
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
      modelRegistry,
      summaryMaxChars = DEFAULT_WORKER_SUMMARY_MAX_CHARS,
    } = options;

    const query = (toolQuery?.trim() || goal).trim();
    const promptCtx: AgentPromptBuildContext = {
      slot: 'deferred_worker',
      toolContext: origin,
      toolSearch: true,
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
      tools = applyExecPolicyToTools(execPolicyConfig, tools);
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
- Shell runs without Owner online approval in this Worker (still subject to deny/dangerous blocks).
- If a tool fails, try an alternative once, then report honestly.
- Final answer: plain language summary for the orchestrator (no tool call syntax).`;

    const maxIterations = options.maxIterations ?? execPolicyConfig?.maxSubagentIterations ?? 15;

    const agent = createAgent(provider, {
      model,
      systemPrompt,
      tools,
      maxIterations,
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
      const raw = result.content?.trim() || 'Task completed with no text response.';
      const summary = truncateWorkerSummary(raw, summaryMaxChars);
      logger.info(formatCompact( {
        ok: true,
        iter: result.iterations,
        tools: loadedToolNames.join(','),
        usage: formatCompactUsage(result.usage),
      }));
      return {
        summary: JSON.stringify({
          status: 'ok',
          loaded_tools: loadedToolNames,
          iterations: result.iterations,
          summary,
        }),
        loadedToolNames,
        iterations: result.iterations,
        status: 'ok',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(formatCompact( {
        ok: false,
        tools: loadedToolNames.join(','),
        error: truncatePreview(errorMsg),
      }));
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

function truncateWorkerSummary(text: string, maxChars: number): string {
  let cleaned = text.trim();
  if (/<tool_call|<function=/i.test(cleaned)) {
    cleaned = 'Worker ended without a plain-text summary; check tool logs.';
  }
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars) + '\n…[truncated]';
}
