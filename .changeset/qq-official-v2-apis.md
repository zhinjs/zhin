---
"@zhin.js/adapter": patch
"@zhin.js/adapter-qq": patch
---

QQ 官方适配器支持群聊和单聊图文卡片，以及群聊、文字子频道的 @全体成员。管理端口可以拉取和审批入群申请，并查询、加入、移出群黑名单。

`@zhin.js/adapter` 的 EndpointManagement 增加可选的群审批和黑名单方法。作用域端口只转发契约上声明的方法，不增加这些方法的话，QQ 端点上的实现到不了调用方。
