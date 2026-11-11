import { projectLocaleToken, resolveLocale, type Locale } from 'zhin.js/i18n';
import {
  definePlugin,
  definePluginCapabilityGraph,
  definePluginConsoleRpc,
  databaseHostToken,
  outboundHostToken,
  pluginConsoleRpcToken,
  scheduleHostToken,
} from 'zhin.js';
import {
  lotteryEnabledGames,
  lotteryKl8,
  resolveLotteryConfig,
  type LotteryConfig,
} from './src/config.js';
import { defineLotteryTables, type LotteryDb } from './src/db.js';
import { createInMemoryLotteryDb } from './src/memory-db.js';
import { lotteryRuntimeStore } from './src/runtime-state.js';
import { runLotteryPipeline } from './src/pipeline.js';

export interface LotteryConsoleStatus {
  readonly enabledGames: readonly string[];
  readonly enabledGamesCount: number;
  readonly pickCount: number;
  readonly historyLimit: number;
  readonly scheduleEnabled: boolean;
  readonly scheduleCron: string;
}

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
  capabilityGraph: definePluginCapabilityGraph({
    provides: [lotteryRuntimeStore, pluginConsoleRpcToken],
    injects: [databaseHostToken, outboundHostToken, scheduleHostToken, projectLocaleToken],
    features: {
      commands: [
        'lottery/[[game]]',
        'lottery-backtest/[[game]]',
        'lottery-history/[game]',
        'lottery-stats/[game]',
        'lottery-today',
        'lottery-train/[[game]]',
      ],
      skills: ['lottery'],
      tools: [
        'skill/lottery/compute-recommend',
        'skill/lottery/get-model-state',
        'skill/lottery/history',
        'skill/lottery/list-pending',
        'skill/lottery/save-prediction',
        'skill/lottery/stats-snapshot',
        'skill/lottery/sync',
      ],
      pages: ['index'],
    },
  }),
  async setup(context) {
    const config = resolveLotteryConfig(context.config.get());
    let projectLocale: Locale | undefined;
    try {
      projectLocale = context.resources.use(projectLocaleToken);
    } catch {
      projectLocale = undefined;
    }
    const locale = resolveLocale(projectLocale);
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
    const enabledGames = Object.freeze([...lotteryEnabledGames(config)]);
    lotteryRuntimeStore.provide(context, Object.freeze({
      locale,
      db,
      config: Object.freeze({ ...config }),
      enabledGames,
      outbound: outboundPush,
    }));

    const consoleRpc = definePluginConsoleRpc({
      status: {
        page: 'index',
        demo: true,
        requiredPermissions: ['lottery:read'],
        handler() {
          return {
            enabledGames: [...enabledGames],
            enabledGamesCount: enabledGames.length,
            pickCount: config.pickCount,
            historyLimit: config.historyLimit,
            scheduleEnabled: Boolean(config.scheduleEnabled),
            scheduleCron: config.scheduleCron || '0 0 18 * * *',
          };
        },
      },
    });

    if (context.resources.has(scheduleHostToken) && config.scheduleEnabled) {
      const schedule = context.resources.use(scheduleHostToken);
      const dispose = schedule.register({
        id: 'lottery/daily_pipeline',
        cron: config.scheduleCron || '0 0 18 * * *',
        description: 'Daily lottery pipeline',
        async execute() {
          await runLotteryPipeline({
            locale,
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
    }

    return {
      consoleRpc,
    };
  },
});
