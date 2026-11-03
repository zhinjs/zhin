---
"@zhin.js/cli": patch
"@zhin.js/host-http": patch
"@zhin.js/console-protocol": patch
---

`zhin config get|set|unset|list` 默认连接运行中的 Host（`config:get-project` / `config:patch-project`），Host 未运行时失败而不再直接写文件；新增 `--offline` 显式本地保存（与 Host 相同的 patchProject 校验，不启动 Runtime）、`--host` / `--token-env` 连接选项、`unset` 子命令（`delete`/`del` 为别名）、按 Schema 脱敏读取与 `--reveal`，以及公开退出码 0/3/4/5/6/7。新增 full-scope `config:get-project` RPC。
