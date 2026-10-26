import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  dbNotReady: { 'zh-CN': '数据库未就绪', en: 'Database is not ready.' },
  syncResult: { 'zh-CN': '同步 {result}', en: 'Sync {result}' },
  reviewTitle: { 'zh-CN': '【彩票推荐复盘】', en: '[Lottery recommendation review]' },
  reviewModel: { 'zh-CN': '■ {game} 模型 {weights}', en: '■ {game} model {weights}' },
  reviewRate: { 'zh-CN': '  累计 {count} 期 平均命中 {rate}%', en: '  {count} draws reviewed; average hit rate {rate}%' },
  reviewEmpty: { 'zh-CN': '  尚无复盘数据', en: '  No reviews yet.' },
  reviewDraw: { 'zh-CN': '  第{issue}期 {detail} ({rate}%)', en: '  Draw {issue}: {detail} ({rate}%)' },
  agentMemory: { 'zh-CN': '【Agent 记忆】', en: '[Agent memory]' },
  pickLine: { 'zh-CN': '■ {label}：{numbers}', en: '■ {label}: {numbers}' },
  noPicks: { 'zh-CN': '暂无推荐号码，请确认已同步开奖数据。', en: 'No picks available. Make sure draw results have been synchronized.' },
  noReport: { 'zh-CN': '今日尚无推荐，请等待定时任务。', en: 'No report for today yet. Wait for the scheduled run.' },
  noReportCommand: { 'zh-CN': '今日尚无推荐，可执行 {command} 或等待定时任务。', en: 'No report for today yet. Run {command} or wait for the scheduled run.' },
  gameRequired: { 'zh-CN': '请指定玩法', en: 'Specify a lottery game.' },
  invalidGame: { 'zh-CN': '无效的玩法', en: 'Invalid lottery game.' },
  noData: { 'zh-CN': '暂无数据', en: 'No data available.' },
  syncRequired: { 'zh-CN': '历史数据不足，请先同步开奖。', en: 'Not enough history. Synchronize draw results first.' },
  syncCommand: { 'zh-CN': '历史数据不足，请先执行 {command} 同步开奖。', en: 'Not enough history. Run {command} to synchronize draw results first.' },
  sample: { 'zh-CN': '样本 {count} 期', en: 'Sample: {count} draws' },
  "zones": {
    "zh-CN": "三区 {zones}",
    "en": "Zones {zones}"
  },
  "oddEven": {
    "zh-CN": "奇偶 {odd}:{even}",
    "en": "Odd/even {odd}:{even}"
  },
  "bigSmall": {
    "zh-CN": "大小 {big}:{small}",
    "en": "High/low {big}:{small}"
  },
  "recentHot": {
    "zh-CN": "近10期热号 {numbers}",
    "en": "Hot numbers in last 10 draws: {numbers}"
  },
  "weights": {
    "zh-CN": "权重 {weights}",
    "en": "Weights {weights}"
  },
  "digitPos": {
    "zh-CN": "第{position}位[{numbers}]",
    "en": "Position {position} [{numbers}]"
  },
  "strategy.balanced": {
    "zh-CN": "均衡",
    "en": "Balanced"
  },
  "strategy.hot": {
    "zh-CN": "热号",
    "en": "Hot"
  },
  "strategy.cold": {
    "zh-CN": "冷号",
    "en": "Cold"
  },
  "strategy.trend": {
    "zh-CN": "趋势",
    "en": "Trend"
  },
  "pickLabel": {
    "zh-CN": "{name}（选{count}）",
    "en": "{name} (pick {count})"
  },
  "pickGroupsLabel": {
    "zh-CN": "{name}（选{count}·{groups}组）",
    "en": "{name} (pick {count} · {groups} groups)"
  },
  "basicDetail": {
    "zh-CN": "频率+遗漏+趋势 | 和值{sum} 跨度{span}",
    "en": "Frequency + omission + trend | Sum {sum}, span {span}"
  },
  "multiDetail": {
    "zh-CN": "多策略 {strategies} | 和值{sum} 跨度{span}",
    "en": "Strategies {strategies} | Sum {sum}, span {span}"
  },
  "redDetail": {
    "zh-CN": "红球 {oddEven} {bigSmall} | 蓝 {blue}",
    "en": "Red {oddEven} {bigSmall} | Blue {blue}"
  },
  "frontDetail": {
    "zh-CN": "前区 {oddEven} {zones}",
    "en": "Front {oddEven} {zones}"
  },
  "digitDetail": {
    "zh-CN": "直选 {positions} | 和值{sum}",
    "en": "Straight {positions} | Sum {sum}"
  },
  "groupLine": {
    "zh-CN": "  组{index}·{label}：{numbers}",
    "en": "  Group {index} · {label}: {numbers}"
  },
  "redLine": {
    "zh-CN": "■ {label}：红 {red} + 蓝 {blue}",
    "en": "■ {label}: Red {red} + Blue {blue}"
  },
  "frontLine": {
    "zh-CN": "■ {label}：前 {front} + 后 {back}",
    "en": "■ {label}: Front {front} + Back {back}"
  },
  "hot": {
    "zh-CN": "热号 {numbers}",
    "en": "Hot {numbers}"
  },
  "cold": {
    "zh-CN": "冷号 {numbers}",
    "en": "Cold {numbers}"
  },
  "accuracy": {
    "zh-CN": "历史命中 {rate}% ({count}期) 近5期 {recent}",
    "en": "Historical hit rate {rate}% ({count} draws), last 5: {recent}"
  },
  "game.kl8": {
    "zh-CN": "快乐8",
    "en": "Happy 8"
  },
  "game.ssq": {
    "zh-CN": "双色球",
    "en": "Double Color Ball"
  },
  "game.dlt": {
    "zh-CN": "超级大乐透",
    "en": "Super Lotto"
  },
  "game.fc3d": {
    "zh-CN": "福彩3D",
    "en": "Fucai 3D"
  },
  "game.pl3": {
    "zh-CN": "排列3",
    "en": "Pick 3"
  },
  "game.pl5": {
    "zh-CN": "排列5",
    "en": "Pick 5"
  },
  "dailyTitle": {
    "zh-CN": "【彩票每日推荐】{date}",
    "en": "[Daily lottery report] {date}"
  },
  "weightFallback": {
    "zh-CN": "【权重保护】近端 holdout 调优未跑赢随机，已回退默认 F40/O35/T25：{games}",
    "en": "[Weight safeguard] Recent holdout tuning did not beat random; reverted to F40/O35/T25: {games}"
  },
  "accuracyOverview": {
    "zh-CN": "【模型复盘】累计平均命中 {overview}",
    "en": "[Model review] Cumulative average hit rate: {overview}"
  },
  "statsExplanation": {
    "zh-CN": "【统计说明】号码由频率+遗漏+近期趋势综合打分，并根据历史命中自动调权。",
    "en": "[Method] Numbers are scored by frequency, omission and recent trends; weights adapt to historical hits."
  },
  "disclaimer": {
    "zh-CN": "免责声明：本推荐由历史数据统计生成，仅供参考，不构成投注建议，不保证中奖。请理性购彩。",
    "en": "Disclaimer: These picks are generated from historical statistics for reference only, not betting advice or a guarantee of winning. Play responsibly."
  },
  "backtestAdaptive": {
    "zh-CN": "{game}: 调优 {rate}%",
    "en": "{game}: adaptive {rate}%"
  },
  "backtestFixed": {
    "zh-CN": "固定 {rate}%",
    "en": "fixed {rate}%"
  },
  "backtestRandom": {
    "zh-CN": "随机 {rate}%",
    "en": "random {rate}%"
  },
  "backtestDelta": {
    "zh-CN": "(Δ调优-随机 {delta}%, n={count}, 热身{warmup}期)",
    "en": "(Δ adaptive-random {delta}%, n={count}, warmup {warmup} draws)"
  },
  "finalWeights": {
    "zh-CN": "终权重 {weights}",
    "en": "final weights {weights}"
  },
  "backtestTitle": {
    "zh-CN": "【回测可信度】近 N 期 walk-forward 抽样",
    "en": "[Backtest confidence] Walk-forward sampling of the latest N draws"
  },
  "backtestNote": {
    "zh-CN": "说明：Δ 接近 0 为正常；终权重见 lottery_model_weights。",
    "en": "Note: Δ near zero is normal; final weights are stored in lottery_model_weights."
  },
  "backtestFallback": {
    "zh-CN": "推荐时若近端调优输给随机，将自动回退默认 F40/O35/T25（见【权重保护】）。",
    "en": "If recent tuning underperforms random, recommendations revert to F40/O35/T25 (see Weight safeguard)."
  },
  "trainFallback": {
    "zh-CN": " [holdout→默认]",
    "en": " [holdout→default]"
  },
  "trainGame": {
    "zh-CN": "{game}: 训练{steps}期 ({first}→{last}){fallback}",
    "en": "{game}: trained on {steps} draws ({first}→{last}){fallback}"
  },
  "trainHit": {
    "zh-CN": "命中 调优{adaptive}% / 固定{fixed}% / 随机{random}%",
    "en": "Hit rate: adaptive {adaptive}% / fixed {fixed}% / random {random}%"
  },
  "trainDelta": {
    "zh-CN": "Δ调优-随机 {delta}%",
    "en": "Δ adaptive-random {delta}%"
  },
  "trainWeights": {
    "zh-CN": "权重 {initial} → {final}",
    "en": "Weights {initial} → {final}"
  },
  "trainEmpty": {
    "zh-CN": "训练失败：历史数据不足，请先同步开奖。",
    "en": "Training failed: not enough history. Synchronize draw results first."
  },
  "trainTitle": {
    "zh-CN": "【权重训练】全历史 walk-forward：预测→比对→调权，已写入 lottery_model_weights",
    "en": "[Weight training] Full-history walk-forward: predict → compare → tune; saved to lottery_model_weights"
  },
  "trainNote": {
    "zh-CN": "说明：训练≠保证未来更准；终权重供后续推荐使用。",
    "en": "Note: training does not guarantee better future results. Final weights are used for later recommendations."
  }
});
