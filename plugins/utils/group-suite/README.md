# @zhin.js/plugin-group-suite

群运营一体化插件（**破坏性合并**，替代以下独立包，不再维护）：

- `@zhin.js/plugin-group-admin`
- `@zhin.js/plugin-checkin`
- `@zhin.js/plugin-stats`
- `@zhin.js/plugin-group-daily-analysis`
- `@zhin.js/plugin-teach`

## 安装

```bash
pnpm add @zhin.js/plugin-group-suite
```

旧包已在 npm 标记废弃（维护者执行）：

```bash
npm login   # 或 export NODE_AUTH_TOKEN=...
node scripts/deprecate-group-legacy-packages.mjs
```

## 配置（扁平 `groupSuite`，多数项有默认值）

```yaml
plugins:
  - "@zhin.js/plugin-group-suite"

database:
  dialect: sqlite
  filename: ./data/bot.db

inbox:
  enabled: true   # 群日报需要

# 可整段省略，使用默认值
groupSuite:
  noticeAdapters: [icqq]
  autoAnalysisEnabled: true
  autoAnalysisCron: "0 9 * * *"
```

常用可选字段（单层，无需 `admin:` / `checkin:` 等嵌套）：

| 字段 | 默认 | 说明 |
|------|------|------|
| `welcome` | 欢迎新成员… | 入群欢迎语 |
| `recallNotify` | `true` | 撤回提示 |
| `keywordReply` | `false` | 内置关键词（建议用 teach） |
| `noticeAdapters` | `[icqq]` | 处理 notice 的适配器 |
| `basePointsMin` / `basePointsMax` | 10 / 30 | 签到积分 |
| `rankSize` | 10 | 签到与统计排行人数 |
| `statsRetentionDays` | 90 | 统计保留天数 |
| `analysisDays` | 1 | 群分析天数 |
| `analysisGroups` | `[]` | 日报白名单（空=不限制） |
| `analysisGroupsBlock` | `[]` | 日报黑名单 |
| `teachMaxPerGroup` | 200 | 每群问答上限 |
| `teachCooldownMs` | 3000 | 问答冷却（毫秒） |

## 命令

| 命令 | 模块 |
|------|------|
| `签到` / `checkin` / `mypoints` / `rank` | 签到 |
| `stats` / `stats-week` / `stats-rank` / `mystats` | 统计 |
| `群分析` / `分析设置` | 日报 |
| `teach` / `teach-regex` / `forget` / `teach-list` | 问答 |
| `添加关键词` … | 仅 `keywordReply: true` |
