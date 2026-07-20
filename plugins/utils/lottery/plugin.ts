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
import { ensureLotteryMemoryDb, getLotteryDb, setLotteryDb } from './src/db-store.js';
import { setLotteryAgentDeps } from './src/lottery-agent-deps.js';
import { runLotteryPipeline } from './src/pipeline.js';
import { setLotteryOutboundPush } from './src/push.js';

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
    if (context.resources.has(databaseHostToken)) {
      const host = context.resources.use(databaseHostToken);
      defineLotteryTables(host);
      setLotteryDb(host);
    } else {
      ensureLotteryMemoryDb();
    }

    if (context.resources.has(outboundHostToken) && config.pushTargets.length > 0) {
      const outbound = context.resources.use(outboundHostToken);
      setLotteryOutboundPush(async (text) => {
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
      });
      context.lifecycle.add(() => setLotteryOutboundPush(null));
    }

    setLotteryAgentDeps({
      getDb: getLotteryDb,
      getConfig: () => ({
        pickCount: config.pickCount,
        historyLimit: config.historyLimit,
        kl8: lotteryKl8(config),
      }),
      plugin: null,
      enabledGames: () => lotteryEnabledGames(config),
      scheduleCron: () => config.scheduleCron,
      scheduleEnabled: () => config.scheduleEnabled,
      pipelinePush: config.pushTargets.length > 0,
    });

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
          getDb: getLotteryDb,
          plugin: null,
          enabledGames: () => lotteryEnabledGames(config),
          historyLimit: config.historyLimit,
          pickCount: config.pickCount,
          kl8: lotteryKl8(config),
          agentEnabled: config.agentEnabled,
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
