---
"@zhin.js/gateway": patch
"@zhin.js/cli": patch
---

`zhin config set|unset` 与 Console 配置补丁的错误说明（#1250）：未知顶层键提示「没有这个配置项」并列出相近的配置项，插件声明键说明去 Console「插件」页或配置文件修改（不再出现 `gateway.plugins.declare` 等 RPC 名）；数组下标越界或该写下标处写了键名时返回 `invalid` 和中文原因（当前长度、如何追加），不再抛出英文的 `Config path … out of bounds`。CLI 只在退出码 6（结果未知）或全局 `--debug` 时在 stderr 打印 `requestId` / `expectedRevision`；校验错误的路径按 `a.b.c` 显示。
