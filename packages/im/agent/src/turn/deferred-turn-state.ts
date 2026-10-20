/**
 * DeferredTurnState — deferred 工具族的跨 turn 可变状态。
 * 从 ZhinAgentPrivate 的散字段收敛而来（第一刀）；由 ZhinAgent 持有一个实例，
 * 消费方经 `priv.deferred` 访问。
 */
import type { AgentTool, DeferredToolSessionSnapshot } from '@zhin.js/ai';
import type { ToolCatalogItem } from '../tool-catalog/types.js';
import type { SubagentResultSender } from '../subagent/index.js';

export class DeferredTurnState {
  /** 当前 turn 可用的 deferred 工具目录（全量 Tool 形态）。 */
  catalog: AgentTool[] = [];
  /** 最近一次展示的目录条目（toolSearch 结果）。 */
  lastCatalog?: ToolCatalogItem[];
  /** 最近一次写入的会话级 deferred 快照。 */
  lastSessionSnapshot?: DeferredToolSessionSnapshot;
  /** 上turn 快照（计算 delta 用）。 */
  lastSnapshotBefore?: DeferredToolSessionSnapshot;
  /** 最近一次 toolSearch 的 deferred 统计文本。 */
  lastToolSearchStats?: string;
  /** deferred/subagent 结果回投器（未装配时为 null，调用方按无回投降级）。 */
  resultSender: SubagentResultSender | null = null;

  #autoContinueDepthBySession = new Map<string, number>();

  getAutoContinueDepth(sessionKey: string): number {
    return this.#autoContinueDepthBySession.get(sessionKey) ?? 0;
  }

  setAutoContinueDepth(sessionKey: string, depth: number): void {
    this.#autoContinueDepthBySession.set(sessionKey, depth);
  }

  resetAutoContinueDepth(sessionKey: string): void {
    this.#autoContinueDepthBySession.delete(sessionKey);
  }

  /** Generation/实例 teardown：清空全部跨 turn 状态。 */
  clear(): void {
    this.catalog = [];
    this.lastCatalog = undefined;
    this.lastSessionSnapshot = undefined;
    this.lastSnapshotBefore = undefined;
    this.lastToolSearchStats = undefined;
    this.resultSender = null;
    this.#autoContinueDepthBySession.clear();
  }
}
