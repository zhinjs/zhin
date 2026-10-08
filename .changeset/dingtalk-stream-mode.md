---
"@zhin.js/adapter-dingtalk": patch
---

新增钉钉 Stream 长连接接收模式，保留默认 HTTP webhook。官方网关注册确认、共享生命周期重连与心跳、停止取消、回调 ACK 和有界去重；失败不会假报连接成功。
