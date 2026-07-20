# @zhin.js/plugin-lottery

多玩法彩票分析插件：快乐8、双色球、大乐透、福彩3D、排列3、排列5。

## 功能

- **单条定时流水线**：同步 → 复盘 → 推荐 → 推送（默认 18:00）
- 频率 + 遗漏 + 趋势综合统计；开奖后自动调权
- 按 `games` 配置过滤，经 Runtime `OutboundHost` 推送到显式 `pushTargets`
- 手动触发：`lottery`（不推送，结果在会话内返回）
- IM commands 通过 owner-scoped `LotteryRuntime` 使用实例 DB。Agent deps 与 Outbound
  sender 使用 generation-owned 注册；配置关闭推送时会显式遮蔽旧 generation，回滚时再
  恢复仍存活的上一代。

## 安装

```bash
pnpm add @zhin.js/plugin-lottery
```

## 流水线

```
scheduleCron (18:00)
  1. sync official draws → lottery_draws
  2. review pending picks vs new issues → tune weights → **lottery_model_weights**
  3. if no new review: replay history simulation → refresh **lottery_model_weights**
  4. compute next-period picks (reads weights from DB) → lottery_predictions
  5. push report to configured targets (enabled games only)
```

权重表 `lottery_model_weights` 每玩法一行，字段 `freq_weight` / `omit_weight` / `trend_weight` + `eval_count` / `avg_hit_rate`：

- **有新开奖且复盘命中**：`submitAgentReview` 增量调权并写库
- **本期未复盘**：用历史 walk-forward 模拟刷新权重后写库（`weightPersistEnabled`）
- **推荐**：`loadGameWeights` 读库中最新权重算号

- **代码层**：官网同步、F/O/T 引擎、复盘调权
- **确定性报告**：主流水线不依赖 legacy Plugin 或 LLM，Agent 可通过独立 tools 读取结果

## 配置

```yaml
plugins:
  lottery:
    scheduleCron: "0 0 18 * * *"
    scheduleEnabled: true
    backtestEnabled: true
    backtestWindow: 50
    backtestRandomTrials: 64
    backtestMinHistory: 30
    pickCount: 5
    historyLimit: 500
    kl8:
      pickCount: 5
      recommendGroups: 3
      groupStrategies: [balanced, hot, cold]
    games: [kl8, ssq, dlt, fc3d, pl3, pl5]
    pushTargets:
      - adapter: sandbox
        endpointId: sandbox-bot
        channelType: private
        channelId: operator
```

## 权重训练（模拟盘）

`lottery-train` 对库内**全部历史**做 walk-forward 训练（无需下注）：

1. 从默认权重 F40/O35/T25 起（第 `minHistory` 期后才有足够历史预测）
2. 每期：用当时权重算号 → 与库中真实开奖比对 → `tuneWeightsFromDraw` 调权
3. 直至往期跑完 → 终权重写入 `lottery_model_weights`

日常 `lottery` 在未复盘时会用同一套全量训练刷新权重；`lottery-backtest` 仅抽样近 N 期做报告。

## 快乐8 多组推荐

同一期可输出多行推荐，每组使用不同 F/O/T 策略（均衡 / 热号 / 冷号 / 趋势）；**组间号码允许重复**，各组独立取该策略下 Top-N。复盘仍以**组1（均衡）**写入 `lottery_predictions`。

```yaml
  kl8:
    pickCount: 5          # 每组选几个号（选5）
    recommendGroups: 3  # 出几组（1~10）
    groupStrategies:
      - balanced
      - hot
      - cold
```

## 回测可信度

每日推荐会自动附带 **walk-forward 逐期模拟**：从默认 F/O/T 权重起，对每一期依次「预测 → 与开奖比对 → 调权」，在无需下注的情况下热身；近 N 期计入评分，并与固定权重、随机基线对比。

```yaml
  backtestAdaptive: true   # 逐期调权模拟（默认开）
  weightPersistEnabled: true  # 模拟/复盘后写入 lottery_model_weights
  weightHoldoutFallback: true  # 近端 holdout 输随机 → 推荐用默认权重
```

## Commands

| Command | Description |
|---------|-------------|
| `lottery [game]` | Manual full pipeline (no push) |
| `lottery-train [game]` | Full-history weight training (DEFAULT → tune → save DB) |
| `lottery-backtest [game]` | Walk-forward backtest vs random baseline |
| `lottery-today` | Today’s published report |
| `lottery-stats <game>` | Single-game stats snapshot |
| `lottery-history <game> [count]` | Historical draws |

## 免责声明

本插件推荐仅供参考，不构成投注建议，不保证中奖。请理性购彩。
