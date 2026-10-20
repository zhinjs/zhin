/**
 * Worker 侧 deferred 工具载入（统一 TF-IDF 选择）。
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
