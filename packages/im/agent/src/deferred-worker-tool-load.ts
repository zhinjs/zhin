/**
 * Worker 侧 deferred 工具载入（默认 TF-IDF；平台策略见 AgentPromptContributor）
 */
import { type AgentTool, filterTools } from '@zhin.js/ai';
export function selectDeferredToolsForWorker(
  query: string,
  _goal: string,
  deferredCatalog: AgentTool[],
  maxTools: number,
): AgentTool[] {
  return filterTools(query, deferredCatalog, { maxTools, minScore: 0.08 });
}
