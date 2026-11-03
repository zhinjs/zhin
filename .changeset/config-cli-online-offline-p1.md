---
"@zhin.js/cli": patch
"@zhin.js/host-http": patch
"@zhin.js/console-protocol": patch
---

**行为变更：Host 未运行时 `zhin config get|set|unset|list` 现在以退出码 7 失败，不再静默写本地文件；离线操作需显式加 `--offline`。**

`zhin config get|set|unset|list` 默认连接运行中的 Host（`config:get-project` / `config:patch-project`）；新增 `--offline` 显式本地保存（与 Host 相同的 patchProject 校验，不启动 Runtime）、`--host` / `--token-env` 连接选项（推导地址时通配监听 `0.0.0.0` / `::` 改连 loopback）、`unset` 子命令（`delete`/`del` 为别名）、按 Schema 脱敏读取与 `--reveal`，以及公开退出码 0/3/4/5/6/7。写请求发出后只有 Host 的权威拒绝（HTTP 400 且回显 requestId）才算未保存，网关 502/504 等一律为结果未知（6），并输出 `requestId` / `expectedRevision` 供核对。新增 full-scope `config:get-project` RPC，读取失败不回显原始错误；`config:patch-project` 保存后事件发布失败不再变成拒绝。
