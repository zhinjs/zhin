---
"@zhin.js/host-http": patch
"@zhin.js/gateway": patch
---

开放 Host（未设 `http.token` 且尚未创建所有者）只接受回环地址、且不带 `X-Forwarded-For` / `Forwarded` 的请求；其他来源按未登录处理。此前把 Host 绑定到 `0.0.0.0` 又不设令牌时，文件、`.env`、数据库与插件安装会对整个网络开放。
