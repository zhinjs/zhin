import { defineSchedule } from '@zhin.js/agent/schedules';
import { formatCompact } from 'zhin.js';
import { getLotteryAgentDeps } from '../../src/lottery-agent-deps.js';
import { runLotteryPipeline } from '../../src/pipeline.js';

export default defineSchedule({
  cron: '0 0 18 * * *',
  description: 'Daily lottery pipeline: sync → review → recommend → push',
  async execute() {
    const deps = getLotteryAgentDeps();
    if (!deps.scheduleEnabled()) return;
    const db = deps.getDb();
    if (!db) return;
    const cfg = deps.getConfig();
    const result = await runLotteryPipeline({
      getDb: deps.getDb,
      plugin: deps.plugin,
      enabledGames: deps.enabledGames,
      historyLimit: cfg.historyLimit,
      pickCount: cfg.pickCount,
      kl8: cfg.kl8,
      agentEnabled: true,
      backtest: { enabled: true, window: 50, randomTrials: 64, minHistory: 30, adaptive: true },
      weightPersist: true,
      weightHoldoutFallback: true,
    }, { push: deps.pipelinePush });
    deps.plugin.logger?.info?.(formatCompact({
      op: 'lottery-pipeline',
      sync: result.sync,
      review: result.review,
      pushed: result.pushed,
    }));
  },
});
