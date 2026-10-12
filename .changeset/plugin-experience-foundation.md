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

修正 Console 配置 Schema 的本地包、实例别名和嵌套插件解析，按 Runtime 的包解析规则定位；缺失 Schema 与非法 Schema 分别反馈。

业务 Outbound Host 发送会拒绝失败、拦截、不支持或结果未知的投递，避免转为成功的空消息 ID；可选状态提示仍由调用方处理发送失败。

RSS 从公开 Message 字段提取会话，以端点隔离订阅，拒绝缺失或不支持的父频道/线程地址，避免改投其他会话。无效来源的 extractChannelInfo 返回 null，移除伪造会话的 SMOKE_CHANNEL 导出。修正实用插件的安装命令与实例配置示例。
