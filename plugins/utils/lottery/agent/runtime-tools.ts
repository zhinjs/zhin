/**
 * Bridge agent/tools/* authoring definitions into the Plugin Runtime Agent Host.
 * Loaded lazily from plugin.ts only when agentToolsHostToken is present, so
 * IM-only installs never pull @zhin.js/agent into the module graph.
 * Lives outside src/ (like the other agent/ authoring files) and is therefore
 * not part of the tsc build — the Plugin Runtime loads it from source.
 */
import type { AgentToolsHost } from '@zhin.js/plugin-runtime';
import syncTool from './tools/sync.js';
import computeRecommendTool from './tools/compute_recommend.js';
import historyTool from './tools/history.js';
import getModelStateTool from './tools/get_model_state.js';
import listPendingTool from './tools/list_pending.js';
import savePredictionTool from './tools/save_prediction.js';
import statsSnapshotTool from './tools/stats_snapshot.js';

interface AuthoringToolLike {
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly keywords?: readonly string[];
  readonly tags?: readonly string[];
  readonly permissions?: readonly string[];
  readonly hidden?: boolean;
  execute(input: never, ctx?: unknown): unknown | Promise<unknown>;
}

const TOOLS: ReadonlyArray<readonly [string, AuthoringToolLike]> = [
  ['lottery_sync', syncTool as AuthoringToolLike],
  ['lottery_compute_recommend', computeRecommendTool as AuthoringToolLike],
  ['lottery_history', historyTool as AuthoringToolLike],
  ['lottery_get_model_state', getModelStateTool as AuthoringToolLike],
  ['lottery_list_pending', listPendingTool as AuthoringToolLike],
  ['lottery_save_prediction', savePredictionTool as AuthoringToolLike],
  ['lottery_stats_snapshot', statsSnapshotTool as AuthoringToolLike],
];

/** Register every lottery agent tool for this generation; returns disposal. */
export function registerLotteryAgentTools(host: AgentToolsHost): () => void {
  const disposers = TOOLS.map(([name, tool]) => host.register({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    source: 'lottery',
    ...(tool.keywords ? { keywords: tool.keywords } : {}),
    ...(tool.tags ? { tags: tool.tags } : {}),
    ...(tool.permissions ? { permissions: tool.permissions } : {}),
    ...(tool.hidden !== undefined ? { hidden: tool.hidden } : {}),
    execute: (input) => tool.execute(input as never, { pluginName: 'lottery', runtimeName: name }),
  }));
  return () => {
    for (const dispose of disposers.splice(0)) dispose();
  };
}
