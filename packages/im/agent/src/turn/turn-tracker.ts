import type { Usage } from '@zhin.js/ai';
import type { ZhinAgentTurnMetrics } from './turn-metrics.js';

export class TurnTracker {
  private _lastMetrics: ZhinAgentTurnMetrics | null = null;

  begin(): void {
    this._lastMetrics = null;
  }

  async finalize(
    partial: Omit<ZhinAgentTurnMetrics, 'usage'> & { usage: Usage },
  ): Promise<void> {
    this._lastMetrics = { ...partial, usage: { ...partial.usage } };
  }

  get lastMetrics(): ZhinAgentTurnMetrics | null {
    return this._lastMetrics;
  }
}
