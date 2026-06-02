import type { Usage } from '@zhin.js/ai';
import { addUsage, EMPTY_USAGE, type ZhinAgentTurnMetrics } from './turn-metrics.js';

export class TurnTracker {
  private _lastMetrics: ZhinAgentTurnMetrics | null = null;
  private activeUsage: Usage | null = null;
  private activeWaits: Promise<void>[] = [];
  private readonly waitMs: number;

  constructor(waitMs: number) {
    this.waitMs = waitMs;
  }

  begin(): void {
    this.activeUsage = { ...EMPTY_USAGE };
    this.activeWaits = [];
  }

  addSubagentUsage(usage: Usage): void {
    if (!this.activeUsage) return;
    addUsage(this.activeUsage, usage);
  }

  trackSubagent(done: Promise<void>): void {
    if (!this.activeUsage) return;
    this.activeWaits.push(done);
  }

  async finalize(
    partial: Omit<ZhinAgentTurnMetrics, 'usage' | 'mainUsage' | 'subagentUsage'> & { usage: Usage },
  ): Promise<void> {
    if (this.activeWaits.length > 0 && this.waitMs > 0) {
      await Promise.race([
        Promise.allSettled(this.activeWaits),
        new Promise<void>(resolve => setTimeout(resolve, this.waitMs)),
      ]);
    }

    const mainUsage = { ...partial.usage };
    const subagentUsage = this.activeUsage
      && (this.activeUsage.total_tokens > 0
        || this.activeUsage.prompt_tokens > 0
        || this.activeUsage.completion_tokens > 0)
      ? { ...this.activeUsage }
      : undefined;

    const totalUsage = { ...mainUsage };
    if (subagentUsage) addUsage(totalUsage, subagentUsage);

    this._lastMetrics = {
      ...partial,
      usage: totalUsage,
      mainUsage,
      ...(subagentUsage ? { subagentUsage } : {}),
    };

    this.activeUsage = null;
    this.activeWaits = [];
  }

  get lastMetrics(): ZhinAgentTurnMetrics | null {
    return this._lastMetrics;
  }
}