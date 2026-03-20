# @zhin.js/plugin-group-daily-analysis

群日常分析插件：基于 zhin 内置收件箱（`unified_inbox_message`）统计群消息、参与人数、活跃时段，可选 LLM 话题/金句/用户画像，支持文本或图片报告与定时推送。

## 依赖

- **收件箱**：需在主配置中启用 `inbox.enabled` 与 `database`，否则无法读取历史消息。
- **可选**：配置 `ai` 服务后可启用话题/金句/用户画像的 LLM 分析。
- **可选**：安装 `@zhin.js/plugin-html-renderer` 且配置 `outputFormat: "image"` 时可输出图片报告。

## 配置

在 `zhin.config.yml` 中：

```yaml
database: { dialect: sqlite, filename: ./data/db.sqlite }
inbox:
  enabled: true

plugins:
  - "@zhin.js/plugin-group-daily-analysis"

group-daily-analysis:
  analysisDays: 1              # 默认分析最近天数
  autoAnalysisEnabled: false   # 是否定时自动分析
  autoAnalysisCron: "0 9 * * *"  # 每日 9 点
  enabledGroups: []           # 群 ID 白名单（空表示不限制）
  disabledGroups: []           # 群 ID 黑名单
  outputFormat: "text"         # text | image（image 需 html-renderer）
  maxMessagesPerAnalysis: 500 # 单次分析最多使用的消息条数
```

## 命令

| 命令 | 说明 |
|------|------|
| `/群分析 [天数]` | 分析本群近期消息（默认 1 天），输出统计与可选 LLM 摘要 |
| `/分析设置 enable` | 为本群启用日常分析（用于定时任务） |
| `/分析设置 disable` | 为本群关闭日常分析 |
| `/分析设置 status` | 查看本群是否已启用分析 |

## 功能说明

- **基础统计**：消息总数、参与人数、总字数、最活跃时段、每小时消息分布。
- **LLM 分析**（需配置 ai）：热门话题、金句筛选、用户称号/画像（灵感见下）。
- **报告格式**：`outputFormat: "text"` 为纯文本；`"image"` 时尝试用 html-renderer 出图，失败则回退文本。
- **定时任务**：`autoAnalysisEnabled: true` 时按 `autoAnalysisCron` 执行；仅对「已启用分析」的群（分析设置 enable 或位于白名单）推送。

## 灵感与参考

本插件的功能与设计参考了以下项目，在此致谢：

- **[astrbot_plugin_qq_group_daily_analysis](https://github.com/SXP-Simon/astrbot_plugin_qq_group_daily_analysis)**  
  AstrBot 的群聊日常分析插件（Python）。本插件中的**话题提取、金句识别、用户画像/称号**等分析思路与交互设计借鉴自该项目。

- **[openmcp-tutorial / qq-group-summary](https://github.com/LSTM-Kirigaya/openmcp-tutorial/tree/main/qq-group-summary)**  
  原 AstrBot 插件 README 中注明的灵感来源之一。

在源码中，与上述参考相关的逻辑已用注释标明「灵感来自 astrbot_plugin_qq_group_daily_analysis」。

## License

MIT
