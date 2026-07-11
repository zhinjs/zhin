import type { Plugin, Tool } from 'zhin.js';
import { buildDailyPipelinePrompt, type LotteryAgentContext, type LotteryAgentTask } from './prompts.js';
import { buildLotteryAgentSystemPrompt } from './read-skills.js';

const LOTTERY_TOOL_PREFIX = 'lottery_';

type AIServiceLike = {
  isReady?: () => boolean;
  listProviders?: () => string[];
  runAgent?: (
    task: string,
    options: {
      systemPrompt?: string;
      tools?: unknown[];
      useBuiltinTools?: boolean;
      collectExternalTools?: boolean;
      maxIterations?: number;
    },
  ) => Promise<{ content: string }>;
};

export interface RunLotteryAgentOptions {
  task: LotteryAgentTask;
  context?: LotteryAgentContext;
  gameId?: string;
  maxIterations?: number;
}

async function resolveLotteryTools(root: Plugin): Promise<unknown[]> {
  const toolService = root.inject('tool') as { getAll: () => Tool[] } | undefined;
  const raw = (toolService?.getAll() ?? []).filter((t) => t.name.startsWith(LOTTERY_TOOL_PREFIX));
  try {
    const agent = await import('zhin.js/agent');
    const normalizeTool = (agent as { normalizeTool?: (t: Tool) => unknown }).normalizeTool;
    if (typeof normalizeTool === 'function') {
      return raw.map((t) => normalizeTool(t));
    }
  } catch {
    /* agent optional */
  }
  return raw;
}

export async function runLotteryAgentTurn(
  root: Plugin,
  options: RunLotteryAgentOptions,
): Promise<{ ok: boolean; text: string; usedAgent: boolean }> {
  const ai = root.inject('ai') as AIServiceLike | undefined;
  if (!ai?.runAgent) return { ok: false, text: '', usedAgent: false };
  const providers = ai.listProviders?.() ?? [];
  if (!providers.length && ai.isReady?.() === false) {
    return { ok: false, text: '', usedAgent: false };
  }

  const userPrompt = buildDailyPipelinePrompt(options.context ?? {});
  const lotteryTools = await resolveLotteryTools(root);

  try {
    const result = await ai.runAgent(userPrompt, {
      systemPrompt: buildLotteryAgentSystemPrompt(),
      tools: lotteryTools,
      useBuiltinTools: true,
      collectExternalTools: false,
      maxIterations: options.maxIterations ?? 14,
    });
    return { ok: true, text: result.content?.trim() ?? '', usedAgent: true };
  } catch (e) {
    return {
      ok: false,
      text: e instanceof Error ? e.message : String(e),
      usedAgent: true,
    };
  }
}
