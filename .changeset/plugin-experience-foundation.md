---
"@zhin.js/cli": patch
"@zhin.js/core": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/plugin-60s": patch
"@zhin.js/plugin-code-runner": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-link-poster": patch
"@zhin.js/plugin-lottery": patch
"@zhin.js/plugin-qrcode": patch
"@zhin.js/plugin-repeater": patch
"@zhin.js/plugin-short-url": patch
---

修正 Console 配置 Schema 的本地包、实例别名和嵌套插件解析，按 Runtime 的包解析规则定位；合并继承插件后检查重复实例。缺失 Schema 与非法 Schema 分别反馈。校验 required 元数据，递归拒绝插件文件中表单不支持的引用、组合、动态字段与 JSON Schema 元组，避免丢弃约束后展示不完整表单。内置 Host 配置保留既有字段投影，复杂配置仍可使用配置文件或源码编辑器；不将该投影视为完整 JSON Schema 编辑器。

业务 Outbound Host 发送会拒绝失败、拦截、不支持或结果未知的投递，避免转为成功的空消息 ID；回执保留明确的平台拒绝状态与未知状态，不凭错误码覆盖投递证据。可选状态提示仍由调用方处理发送失败。

RSS 从公开 Message 字段提取会话，以端点隔离订阅，拒绝缺失或不支持的父频道/线程地址，避免改投其他会话。无效来源的 extractChannelInfo 返回 null，移除伪造会话的 SMOKE_CHANNEL 导出。修正实用插件的安装命令与实例配置示例。
