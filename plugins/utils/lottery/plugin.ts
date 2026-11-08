import { randomUUID } from 'node:crypto';
import { projectLocaleToken, resolveLocale, type Locale } from 'zhin.js/i18n';
import {
  definePlugin,
  definePluginCapabilityGraph,
  definePluginConsoleRpc,
  databaseHostToken,
  outboundHostToken,
  pluginConsoleRpcToken,
  scheduleHostToken,
  type NormalizedPluginConsoleRpcMethod,
  type PluginConsoleRpcInput,
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

export interface LotteryTestDrawItem {
  readonly id: string;
  readonly userId: string;
  readonly fortune: string;
  readonly summary: string;
  readonly numbers: string;
  readonly createdAt: string;
  readonly [key: string]: string;
}

export interface LotteryConsoleStatus {
  readonly enabledGames: readonly string[];
  readonly enabledGamesCount: number;
  readonly pickCount: number;
  readonly historyLimit: number;
  readonly scheduleEnabled: boolean;
  readonly scheduleCron: string;
  readonly recentTestCount: number;
  readonly recentDraws: readonly LotteryTestDrawItem[];
}

const FORTUNE_POOL = [
  { tier: '大吉', summary: '紫气东来，万事顺遂，宜积极进取' },
  { tier: '中吉', summary: '吉星高照，稳步前行，宜把握良机' },
  { tier: '小吉', summary: '春风化雨，平顺安康，宜循序渐进' },
  { tier: '吉', summary: '心诚则灵，水到渠成，宜踏实耕耘' },
  { tier: '末吉', summary: '厚积薄发，静待花开，宜稳中求进' },
] as const;

function pickSampleNumbers(): string {
  const pool = Array.from({ length: 33 }, (_, idx) => idx + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const reds = pool
    .slice(0, 6)
    .sort((a, b) => a - b)
    .map((n) => String(n).padStart(2, '0'));
  const blue = String(Math.floor(Math.random() * 16) + 1).padStart(2, '0');
  return `${reds.join(' ')} + ${blue}`;
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

    const recentDraws: LotteryTestDrawItem[] = [];
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
            recentTestCount: recentDraws.length,
            recentDraws: [...recentDraws],
          };
        },
      },
      actions: {
        'draw-test': {
          page: 'index',
          requiredPermissions: ['lottery:write'],
          handler(input: PluginConsoleRpcInput) {
            const userId =
              typeof input.userId === 'string' && input.userId.trim()
                ? input.userId.trim()
                : 'console-tester';
            const picked = FORTUNE_POOL[Math.floor(Math.random() * FORTUNE_POOL.length)]!;
            const numbers = pickSampleNumbers();
            const entry: LotteryTestDrawItem = {
              id: randomUUID().slice(0, 8),
              userId,
              fortune: picked.tier,
              summary: picked.summary,
              numbers,
              createdAt: new Date().toISOString(),
            };
            recentDraws.unshift(entry);
            if (recentDraws.length > 20) {
              recentDraws.length = 20;
            }
            return {
              ok: true,
              userId,
              fortune: picked.tier,
              summary: picked.summary,
              numbers,
              message: `模拟抽签结果 [${userId}]：${picked.tier}（${picked.summary}）· 幸运号码：${numbers}`,
            };
          },
        },
      },
    });

    const methods = consoleRpc.methods as Map<string, NormalizedPluginConsoleRpcMethod>;
    const drawTestMethod = methods.get('draw-test');
    if (drawTestMethod) {
      methods.set('drawTest', drawTestMethod);
    }

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
