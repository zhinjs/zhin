import {
  definePlugin,
  databaseHostToken,
  outboundHostToken,
  scheduleHostToken,
} from 'zhin.js/plugin-runtime';
import {
  lotteryEnabledGames,
  lotteryKl8,
  resolveLotteryConfig,
  type LotteryConfig,
} from './src/config.js';
import { defineLotteryTables, type LotteryDb } from './src/db.js';
import { createInMemoryLotteryDb } from './src/memory-db.js';
import { lotteryRuntimeToken } from './src/runtime-state.js';
import { runLotteryPipeline } from './src/pipeline.js';

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
  async setup(context) {
    const config = resolveLotteryConfig(context.config.get());
    // host 与 memory 模型表面结构兼容（where 均返回 PromiseLike），可直接互换。
    const db: LotteryDb = (() => {
      if (context.resources.has(databaseHostToken)) {
        const host = context.resources.use(databaseHostToken);
        defineLotteryTables(host);
        return host;
      }
      return createInMemoryLotteryDb();
    })();
    let outboundPush: ((text: string) => Promise<void>) | null = null;
    if (context.resources.has(outboundHostToken) && config.pushTargets.length > 0) {
      const outbound = context.resources.use(outboundHostToken);
      outboundPush = async (text) => {
        for (const target of config.pushTargets) {
          try {
            await outbound.send({
              adapter: target.adapter,
              endpointKey: target.endpointKey || target.adapter,
              conversation: {
                kind: (target.channelType || 'private') as 'private' | 'group' | 'channel',
                id: target.channelId,
              },
              content: text,
            });
          } catch {
            // OutboundHost logs; continue remaining targets.
          }
        }
      };
    }
    context.resources.provide(lotteryRuntimeToken, Object.freeze({
      db,
      config: Object.freeze({ ...config }),
      enabledGames: Object.freeze([...lotteryEnabledGames(config)]),
      outbound: outboundPush,
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
          db,
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
          outbound: outboundPush,
        }, { push: config.pushTargets.length > 0 });
      },
    });
    context.lifecycle.add(dispose);
  },
});
