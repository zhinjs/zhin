---
"@zhin.js/console-protocol": minor
"zhin.js": minor
---

Console「需要你处理」评审修复：`attention.list` 新增 `unavailableDetails: { source, reason }[]`（与 `unavailable` 同序；`reason` 为脱敏后的简短原因，不含绝对路径或凭据；旧字段 `unavailable: string[]` 保留），并按来源限频写 warn 日志；单个插件 `inspect` 失败时只为该插件生成 `plugin.error` 条目（带原因，如提示运行 `zhin migrate instances`），其余插件照常出条目，所有插件因同一原因失败（如旧版生命周期状态）时合并为一条项目级条目；离线账号条目的连接状态改为可读说法（已连接 / 连接中 / 已断开 / 重连中…，未知值显示「未知」），工具审批条目不再在文案中显示内部会话 key，改为来源会话的描述（群 / 频道 / 私聊），无法解析时写「一个会话」。
