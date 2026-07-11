/**
 * @zhin.js/plugin-lottery — scheduled pipeline: sync → review → recommend → push
 */
import { formatCompact, MessageCommand, Schema, usePlugin } from 'zhin.js';
import type { GameId } from './types.js';
import { parseGameId, resolveEnabledGames } from './games/registry.js';
import {
  defineLotteryTables,
  loadDraws,
  type LotteryDb,
} from './db.js';
import {
  formatDailyReportText,
  loadTodayReport,
} from './recommend/report.js';
import { recommendGame, formatPickLine, formatPickStats } from './recommend/game-pick.js';
import {
  loadAccuracySnapshot,
  loadGameWeights,
} from './evaluate/tracker.js';
import { setLotteryAgentDeps } from './lottery-agent-deps.js';
import { formatPipelineReply, runLotteryPipeline } from './pipeline.js';
import { formatBacktestSection, formatTrainReport, runBacktestForGames, trainAllGameWeights } from './evaluate/backtest.js';
import { resolveKl8Config, type Kl8ConfigInput } from './games/kl8-groups.js';

const plugin = usePlugin();
const { logger, addCommand, useContext, onDispose, declareConfig } = plugin;

const config = declareConfig(
  'lottery',
  Schema.object({
    pickCount: Schema.number().default(5).min(1).max(10).description('KL8 pick count'),
    scheduleCron: Schema.string().default('0 0 18 * * *').description('Daily pipeline cron (sync→review→recommend→push)'),
    historyLimit: Schema.number().default(500).min(50).max(2000).description('Max draws kept per game'),
    scheduleEnabled: Schema.boolean().default(true).description('Enable scheduled pipeline'),
    agentEnabled: Schema.boolean().default(true).description('AI narrative on daily report (optional)'),
    backtestEnabled: Schema.boolean().default(true).description('Walk-forward backtest vs random baseline in report'),
    backtestWindow: Schema.number().default(50).min(10).max(300).description('Backtest periods per game'),
    backtestRandomTrials: Schema.number().default(64).min(10).max(500).description('Monte Carlo random trials per period'),
    backtestMinHistory: Schema.number().default(30).min(10).max(150).description('Min history before walk-forward'),
    backtestAdaptive: Schema.boolean().default(true).description('Per-period weight tuning in backtest simulation'),
    weightPersistEnabled: Schema.boolean().default(true).description('Persist simulated F/O/T weights to lottery_model_weights'),
    weightHoldoutFallback: Schema.boolean().default(true).description('Use DEFAULT weights when holdout adaptive loses to random'),
    kl8: Schema.object({
      pickCount: Schema.number().default(5).min(1).max(10).description('Numbers per KL8 group (选N)'),
      recommendGroups: Schema.number().default(3).min(1).max(10).description('KL8 recommendation rows per day'),
      groupStrategies: Schema.list(Schema.string()).default(['balanced', 'hot', 'cold']),
    }).description('KL8 multi-strategy groups'),
    games: Schema.list(Schema.string()).default(['kl8', 'ssq', 'dlt', 'fc3d', 'pl3', 'pl5']),
  }),
);

let _db: LotteryDb | null = null;

function getDb(): LotteryDb | null {
  return _db;
}

function enabledGames(): GameId[] {
  return resolveEnabledGames(config.games as string[]);
}

function pipelineDeps() {
  const kl8 = resolveKl8Config(config.pickCount, config.kl8 as Kl8ConfigInput | undefined);
  return {
    getDb,
    plugin,
    enabledGames,
    historyLimit: config.historyLimit,
    pickCount: config.pickCount,
    kl8,
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
  };
}

function refreshLotteryAgentDeps(): void {
  setLotteryAgentDeps({
    getDb: () => _db,
    getConfig: () => ({
      pickCount: config.pickCount,
      historyLimit: config.historyLimit,
      kl8: resolveKl8Config(config.pickCount, config.kl8 as Kl8ConfigInput | undefined),
    }),
    plugin,
    enabledGames,
    scheduleCron: () => config.scheduleCron,
    scheduleEnabled: () => config.scheduleEnabled,
    pipelinePush: true,
  });
}

refreshLotteryAgentDeps();

useContext('database', (db: unknown) => {
  const d = db as { define: (n: string, s: Record<string, unknown>) => void };
  defineLotteryTables(d);
  _db = db as LotteryDb;
  refreshLotteryAgentDeps();
  logger.debug(formatCompact({ op: 'lottery-ready', schedule: config.scheduleEnabled }));
});

onDispose(() => {});

// ─── Commands ───────────────────────────────────────────────────────────────

addCommand(
  new MessageCommand('lottery [game:word]')
    .desc('Run full pipeline: sync → review → recommend (manual, no push)')
    .action(async (_msg, result) => {
      const gid = parseGameId(result.params.game ?? '');
      const out = await runLotteryPipeline(pipelineDeps(), { gameId: gid ?? undefined, push: false });
      return formatPipelineReply(out);
    }),
);

addCommand(
  new MessageCommand('lottery-train [game:word]')
    .desc('Full-history weight training: predict→compare→tune from DEFAULT, persist to DB')
    .action(async (_msg, result) => {
      const db = getDb();
      if (!db) return '数据库未就绪';
      const gid = parseGameId(result.params.game ?? '');
      const gameIds = gid ? [gid] : enabledGames();
      const results = await trainAllGameWeights(db, gameIds, {
        pickCount: config.pickCount,
        minHistory: config.backtestMinHistory,
        historyLimit: config.historyLimit,
        randomTrials: config.backtestRandomTrials,
        holdoutWindow: config.backtestWindow,
        holdoutFallback: config.weightHoldoutFallback,
        persist: true,
      });
      return formatTrainReport(results);
    }),
);

addCommand(
  new MessageCommand('lottery-backtest [game:word]')
    .desc('Walk-forward backtest: strategy vs random baseline (no betting)')
    .action(async (_msg, result) => {
      const db = getDb();
      if (!db) return '数据库未就绪';
      const gid = parseGameId(result.params.game ?? '');
      const gameIds = gid ? [gid] : enabledGames();
      const summaries = await runBacktestForGames(db, gameIds, {
        pickCount: config.pickCount,
        window: config.backtestWindow,
        randomTrials: config.backtestRandomTrials,
        minHistory: config.backtestMinHistory,
        historyLimit: config.historyLimit,
        adaptive: config.backtestAdaptive,
      });
      const text = formatBacktestSection(summaries);
      return text || '历史数据不足，请先执行 lottery 同步开奖';
    }),
);

addCommand(
  new MessageCommand('lottery-today')
    .desc('Show today published recommendation report')
    .action(async () => {
      const db = getDb();
      if (!db) return '数据库未就绪';
      const report = await loadTodayReport(db);
      if (!report) return '今日尚无推荐，可执行 lottery 或等待定时任务';
      return formatDailyReportText(report, '');
    }),
);

addCommand(
  new MessageCommand('lottery-stats <game:word>')
    .desc('Single-game stats snapshot (code engine)')
    .action(async (_msg, result) => {
      const gid = parseGameId(result.params.game ?? '');
      if (!gid) return '请指定玩法';
      const db = getDb();
      if (!db) return '数据库未就绪';
      const draws = await loadDraws(db, gid, config.historyLimit);
      if (!draws.length) return '暂无数据，请先 lottery';
      const kl8 = resolveKl8Config(config.pickCount, config.kl8 as Kl8ConfigInput | undefined);
      const pick = recommendGame(gid, draws, {
        pickCount: gid === 'kl8' ? kl8.pickCount : config.pickCount,
        tieSeed: 'stats',
        weights: await loadGameWeights(db, gid),
        accuracy: await loadAccuracySnapshot(db, gid),
        kl8: gid === 'kl8' ? kl8 : undefined,
      });
      return [formatPickLine(pick), formatPickStats(pick), `样本 ${draws.length} 期`].join('\n');
    }),
);

addCommand(
  new MessageCommand('lottery-history <game:word> [count:number=10]')
    .desc('List historical draw results')
    .action(async (_msg, result) => {
      const gid = parseGameId(result.params.game ?? '');
      if (!gid) return '请指定玩法';
      const db = getDb();
      if (!db) return '数据库未就绪';
      const count = Math.min(50, Math.max(1, Number(result.params.count) || 10));
      const draws = await loadDraws(db, gid, count);
      if (!draws.length) return '暂无数据';
      return draws.map((d) => `${d.issue} ${d.drawTime} ${JSON.stringify(d.numbers)}`).join('\n');
    }),
);

export default plugin;
