import {
  definePlugin,
  databaseHostToken,
  outboundHostToken,
  scheduleHostToken,
} from '@zhin.js/plugin-runtime';
import {
  lotteryEnabledGames,
  lotteryKl8,
  resolveLotteryConfig,
  type LotteryConfig,
} from './src/config.js';
import { defineLotteryTables } from './src/db.js';
import { registerLotteryDb } from './src/db-store.js';
import { registerLotteryAgentDeps } from './src/lottery-agent-deps.js';
import { createInMemoryLotteryDb } from './src/memory-db.js';
import { lotteryRuntimeToken } from './src/runtime-state.js';
import { runLotteryPipeline } from './src/pipeline.js';
import { registerLotteryOutboundPush } from './src/push.js';

/**
 * Plugin Runtime:
 * - DB: prefer databaseHostToken; else memory.
 * - Push: OutboundHost + config.pushTargets (cron / publish).
 * - Cron: scheduleHostToken daily pipeline.
 */
export default definePlugin<LotteryConfig>({
  name: 'lottery',
  metadata: {
    displayName: 'Lottery',
  },
  setup(context) {
    const config = resolveLotteryConfig(context.config.get());
    const db = context.resources.has(databaseHostToken)
      ? context.resources.use(databaseHostToken)
      : createInMemoryLotteryDb();
    if (context.resources.has(databaseHostToken)) {
      defineLotteryTables(db);
    }
    context.resources.provide(lotteryRuntimeToken, { db });
    context.lifecycle.add(registerLotteryDb(db));

    let outboundPush: ((text: string) => Promise<void>) | null = null;
    if (context.resources.has(outboundHostToken) && config.pushTargets.length > 0) {
      const outbound = context.resources.use(outboundHostToken);
      outboundPush = async (text) => {
        for (const target of config.pushTargets) {
          try {
            await outbound.send({
              adapter: target.adapter,
              endpointId: target.endpointId || target.adapter,
              channelType: target.channelType || 'private',
              channelId: target.channelId,
              content: text,
            });
          } catch {
            // OutboundHost logs; continue remaining targets.
          }
        }
      };
    }
    context.lifecycle.add(registerLotteryOutboundPush(outboundPush));

    context.lifecycle.add(registerLotteryAgentDeps({
      getDb: () => db,
      getConfig: () => ({
        pickCount: config.pickCount,
        historyLimit: config.historyLimit,
        kl8: lotteryKl8(config),
      }),
      enabledGames: () => lotteryEnabledGames(config),
      scheduleCron: () => config.scheduleCron,
      scheduleEnabled: () => config.scheduleEnabled,
      pipelinePush: config.pushTargets.length > 0,
    }));

    if (!context.resources.has(scheduleHostToken) || !config.scheduleEnabled) {
      return;
    }
    const schedule = context.resources.use(scheduleHostToken);
    const dispose = schedule.register({
      id: 'lottery/daily_pipeline',
      cron: config.scheduleCron || '0 0 18 * * *',
      description: 'Daily lottery pipeline',
      async execute() {
        await runLotteryPipeline({
          getDb: () => db,
          enabledGames: () => lotteryEnabledGames(config),
          historyLimit: config.historyLimit,
          pickCount: config.pickCount,
          kl8: lotteryKl8(config),
          backtest: {
            enabled: config.backtestEnabled,
            window: config.backtestWindow,
            randomTrials: config.backtestRandomTrials,
            minHistory: config.backtestMinHistory,
            adaptive: config.backtestAdaptive,
          },
          weightPersist: config.weightPersistEnabled,
          weightHoldoutFallback: config.weightHoldoutFallback,
        }, { push: config.pushTargets.length > 0 });
      },
    });
    context.lifecycle.add(dispose);
  },
});
