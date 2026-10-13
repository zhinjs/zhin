---
"@zhin.js/cli": patch
"@zhin.js/console-protocol": patch
"@zhin.js/host-http": patch
"@zhin.js/core": patch
"@zhin.js/runtime": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/feature-kit": patch
"@zhin.js/adapter": patch
"@zhin.js/handler": patch
"@zhin.js/mcp-feature": patch
---

补齐 Console 安装配置闭环所需的精确配置路径、端点身份、平台就绪与验证计划失效语义，并保存历史消息的方向及实际投递诊断。

修复真实 ICQQ 入站目标保存了插件 owner 而非平台标识、导致提醒投递被身份校验拒绝的问题；无关插件配置变更保留原有适配器连接。

保证候选事件在当前代快照发布后准入，并避免安装过程中依赖文件变动提前中断插件管理操作。

明确 Adapter/MCP 客户端创建仅提供所属 owner 的配置与资源，跨 Feature 查询由当前 operation 上下文负责；入站诊断记录接收时刻，避免慢指令的回复在历史中先于指令。
